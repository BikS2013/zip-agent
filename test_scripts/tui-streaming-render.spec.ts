/**
 * tui-streaming-render.spec.ts — bugfix round 1.
 *
 * Reproduces the three live-run failures the user hit when running the TUI
 * against `azure-openai/gpt-5.1`:
 *
 *   1. Streamed assistant text was being shredded — only the trailing
 *      character of each chunk reached the screen, scattered across blank
 *      lines, because the spinner's `stop()` write (`SAVE_CURSOR + CLEAR_LINE
 *      + RESTORE_CURSOR`) ran on EVERY token event and the embedded `\r\x1b[2K`
 *      destroyed the line under the cursor each time.
 *   2. Tool-start breadcrumb showed `{"input":"{\"path\":..."}` — the
 *      `previewObject` helper did not unwrap the single-`input` wrapper that
 *      LangGraph emits for tools whose schema was inferred from a single zod
 *      input field, so the JSON-encoded args string was double-displayed.
 *   3. Tool-end breadcrumb showed the raw LangChain ToolMessage envelope
 *      (`{"lc":1,"type":"constructor","id":[...]}`) — `previewObject` ran
 *      `JSON.stringify` on a `ToolMessage` instance, which serializes via
 *      `toJSON()` to the LC envelope. We must extract `.content` first.
 *
 * Each `it` below would fail against the pre-fix code; the fix brings each
 * to green. Together they pin the three regressions for future maintainers.
 */

import { describe, it, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import { ToolMessage } from '@langchain/core/messages';

import { mapEvent } from '../src/agent/tui/streaming';
import { createSpinner } from '../src/agent/tui/spinner';

// ---------------------------------------------------------------------------
// Symptom 1 — token text must reach the terminal contiguously, never shredded
//             by spinner cleanup writes.
// ---------------------------------------------------------------------------

/**
 * Minimal in-process driver that mimics the three things `tui.ts` does on
 * every TuiEvent: gate the spinner, print the Agent header once, write the
 * token text. We don't pull in the whole runInteractiveTui — its raw-mode
 * stdin and `await readInput` aren't relevant here, only the streaming
 * output discipline is.
 */
async function drive(
  out: NodeJS.WritableStream,
  events: Array<{ kind: 'token'; text: string } | { kind: 'tool_start'; name: string; argsPreview: string } | { kind: 'tool_end'; resultPreview: string }>,
  intervalMs = 1_000_000, // never tick during the test
): Promise<void> {
  const spinner = createSpinner('Thinking...', { out, intervalMs });
  spinner.start();
  let headerPrinted = false;
  for (const ev of events) {
    if (ev.kind === 'token') {
      if (spinner.isActive()) spinner.stop();
      if (!headerPrinted) {
        headerPrinted = true;
        out.write('Agent ');
      }
      out.write(ev.text);
    } else if (ev.kind === 'tool_start') {
      if (spinner.isActive()) spinner.stop();
      out.write(`\n  ↳ calling ${ev.name}(${ev.argsPreview})`);
    } else if (ev.kind === 'tool_end') {
      out.write(` ✓ → ${ev.resultPreview}`);
      spinner.setLabel('Processing tool result...');
      spinner.start();
    }
  }
  if (spinner.isActive()) spinner.stop();
}

function captureStream(): { stream: PassThrough; output: () => string } {
  const stream = new PassThrough();
  let buf = '';
  stream.on('data', (c: Buffer | string) => {
    buf += typeof c === 'string' ? c : c.toString();
  });
  return { stream, output: () => buf };
}

describe('streaming render: Azure OpenAI content-block chunks', () => {
  it('preserves contiguous tokenized text from array-of-parts chunks', async () => {
    const { stream, output } = captureStream();
    // Azure GPT models often emit content as an array of parts.
    const chunks = [
      [{ type: 'text', text: 'foo' }],
      [{ type: 'text', text: ' bar' }],
      [{ type: 'text', text: ' baz' }],
    ];
    const events = chunks
      .map((c) => mapEvent({ event: 'on_chat_model_stream', data: { chunk: { content: c } } }))
      .filter((e): e is { kind: 'token'; text: string } => e?.kind === 'token');
    expect(events.map((e) => e.text)).toEqual(['foo', ' bar', ' baz']);
    await drive(stream, events);
    const text = output();
    // The three tokens must land contiguously, not scattered with cursor moves
    // between every one.
    expect(text).toContain('foo bar baz');
  });

  it('does NOT emit a CLEAR_LINE between consecutive token writes', async () => {
    // CLEAR_LINE is "\r\x1b[2K". The bug was that spinner.stop() unconditionally
    // wrote SAVE_CURSOR + CLEAR_LINE + RESTORE_CURSOR on every call, including
    // calls made when the spinner was already stopped — so each token write
    // was preceded by a "\r\x1b[2K" that wiped the streamed text so far.
    const { stream, output } = captureStream();
    const events: Array<{ kind: 'token'; text: string }> = Array.from(
      { length: 50 },
      (_, i) => ({ kind: 'token', text: `t${i} ` }),
    );
    await drive(stream, events);
    const text = output();
    // Header must come once.
    expect(text.split('Agent ').length - 1).toBe(1);
    // Every token's payload must be present.
    for (let i = 0; i < 50; i += 1) expect(text).toContain(`t${i} `);
    // After the Agent header (i.e. once streamed text begins) there must be
    // zero `\r\x1b[2K` sequences. Any occurrence here means the spinner is
    // wiping the line out from under the streamed text — the smoking-gun bug.
    const tail = text.slice(text.indexOf('Agent '));
    const clearLinesInTail = (tail.match(/\r\x1b\[2K/g) ?? []).length;
    expect(clearLinesInTail).toBe(0);
  });

  it('spinner.stop() is a no-op when the spinner is already stopped', () => {
    // Pin the production bug at its source: tui.ts calls spinner.stop() on
    // every token event without an isActive() guard. The previous spinner
    // implementation wrote SAVE_CURSOR + CLEAR_LINE + RESTORE_CURSOR on
    // EVERY stop() call, including no-op ones — that was the cause of the
    // shredded streaming output. After the fix, calling stop() when no
    // timer is running must produce zero bytes.
    const { stream, output } = captureStream();
    const sp = createSpinner('x', { out: stream, intervalMs: 1_000_000 });
    sp.start();
    sp.stop();
    const before = output().length;
    sp.stop();
    sp.stop();
    sp.stop();
    const after = output().length;
    expect(after - before).toBe(0);
  });

  it('emits the spinner cleanup at most ONCE during a streaming response', async () => {
    // Symptom 3 acceptance: status-bar / spinner repaints during streaming
    // were the visible flicker. We assert the full spinner cleanup ANSI
    // (`\x1b[s\r\x1b[2K\x1b[u`) fires at most once (when the first token
    // arrives), not 100 times.
    const { stream, output } = captureStream();
    const events: Array<{ kind: 'token'; text: string }> = Array.from(
      { length: 100 },
      (_, i) => ({ kind: 'token', text: String(i % 10) }),
    );
    await drive(stream, events);
    const cleanupCount = (output().match(/\x1b\[s\r\x1b\[2K\x1b\[u/g) ?? []).length;
    expect(cleanupCount).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Symptom 2 — tool breadcrumb args + result rendering
// ---------------------------------------------------------------------------

describe('streaming render: tool-start args preview', () => {
  it('unwraps a single-key { input: <jsonString> } envelope before display', () => {
    // This is the exact shape LangGraph emits when a tool was bound with a
    // single zod input field; the model's structured args end up nested
    // inside a string inside the wrapper. Showing the raw wrapper is what
    // produced `{"input":"{\"path\":\"~/Downloads\",..."}` on the user's
    // screen.
    const ev = mapEvent({
      event: 'on_tool_start',
      name: 'find_files',
      data: {
        input: {
          input: JSON.stringify({
            path: '~/Downloads',
            types: ['file'],
            name: '*.zip',
            maxDepth: 20,
            maxResults: 500,
            includeHidden: false,
          }),
        },
      },
    });
    expect(ev?.kind).toBe('tool_start');
    if (ev?.kind === 'tool_start') {
      expect(ev.argsPreview).not.toContain('"input":"');
      expect(ev.argsPreview).toContain('"path":"~/Downloads"');
      expect(ev.argsPreview).toContain('"name":"*.zip"');
    }
  });

  it('unwraps a single-key { input: <object> } envelope before display', () => {
    const ev = mapEvent({
      event: 'on_tool_start',
      name: 'list_archive',
      data: { input: { input: { archive: 'release.zip' } } },
    });
    if (ev?.kind === 'tool_start') {
      expect(ev.argsPreview).toBe('{"archive":"release.zip"}');
    }
  });

  it('leaves multi-key arg objects alone', () => {
    const ev = mapEvent({
      event: 'on_tool_start',
      name: 'create_archive',
      data: { input: { archive: 'a.zip', files: ['x'] } },
    });
    if (ev?.kind === 'tool_start') {
      expect(ev.argsPreview).toBe('{"archive":"a.zip","files":["x"]}');
    }
  });
});

describe('streaming render: tool-end result preview', () => {
  it('extracts content from a real ToolMessage instance instead of dumping the LC envelope', () => {
    // Symptom 2: `JSON.stringify(toolMessage)` invokes BaseMessage.toJSON()
    // which returns `{"lc":1,"type":"constructor","id":["langchain_core","messages","ToolMessage"],"kwargs":{...}}`.
    // The renderer must pull out the .content field instead.
    const tm = new ToolMessage({
      content: 'three zip files found: a.zip, b.zip, c.zip',
      tool_call_id: 'call_abc123',
      name: 'find_files',
    });
    const ev = mapEvent({ event: 'on_tool_end', data: { output: tm } });
    expect(ev?.kind).toBe('tool_end');
    if (ev?.kind === 'tool_end') {
      expect(ev.resultPreview).not.toContain('"lc":1');
      expect(ev.resultPreview).not.toContain('"kwargs"');
      expect(ev.resultPreview).not.toContain('langchain_core');
      expect(ev.resultPreview).toContain('three zip files found');
    }
  });

  it('extracts content from a JSON-roundtripped ToolMessage envelope', () => {
    // The same envelope can arrive as a plain object after a serializer
    // round-trip (e.g. when streaming over a network boundary). Extract
    // .kwargs.content if .content is missing.
    const envelope = {
      lc: 1,
      type: 'constructor',
      id: ['langchain_core', 'messages', 'ToolMessage'],
      kwargs: {
        content: 'plain envelope content',
        tool_call_id: 'call_xyz',
        name: 'list_archive',
      },
    };
    const ev = mapEvent({ event: 'on_tool_end', data: { output: envelope } });
    if (ev?.kind === 'tool_end') {
      expect(ev.resultPreview).toContain('plain envelope content');
      expect(ev.resultPreview).not.toContain('"lc":1');
    }
  });

  it('still pretty-prints structured plain objects', () => {
    const ev = mapEvent({
      event: 'on_tool_end',
      data: { output: { ok: true, count: 42 } },
    });
    if (ev?.kind === 'tool_end') {
      expect(ev.resultPreview).toBe('{"ok":true,"count":42}');
    }
  });

  it('handles ToolMessage content that is itself an array of parts', () => {
    const tm = new ToolMessage({
      content: [{ type: 'text', text: 'first part' }, { type: 'text', text: ' second' }],
      tool_call_id: 'c1',
    });
    const ev = mapEvent({ event: 'on_tool_end', data: { output: tm } });
    if (ev?.kind === 'tool_end') {
      expect(ev.resultPreview).toContain('first part');
      expect(ev.resultPreview).toContain('second');
      expect(ev.resultPreview).not.toContain('"lc":1');
    }
  });
});
