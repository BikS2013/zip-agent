/**
 * tui-streaming.spec.ts — adapter that maps LangGraph v2 events to TuiEvents.
 *
 * The mapping is pure (mapEvent) so we test it directly without spinning up
 * a real LangGraph stream.
 */

import { describe, it, expect } from 'vitest';
import { mapEvent, stringifyContent } from '../src/agent/tui';

describe('mapEvent', () => {
  it('maps on_chat_model_stream → token with the chunk content', () => {
    const ev = mapEvent({ event: 'on_chat_model_stream', data: { chunk: { content: 'hello' } } });
    expect(ev).toEqual({ kind: 'token', text: 'hello' });
  });

  it('drops empty-content chat-model-stream events', () => {
    const ev = mapEvent({ event: 'on_chat_model_stream', data: { chunk: { content: '' } } });
    expect(ev).toBeNull();
  });

  it('decodes Anthropic-style array content (parts with text)', () => {
    const ev = mapEvent({
      event: 'on_chat_model_stream',
      data: { chunk: { content: [{ type: 'text', text: 'AB' }, { type: 'text', text: 'CD' }] } },
    });
    expect(ev).toEqual({ kind: 'token', text: 'ABCD' });
  });

  it('maps on_tool_start → tool_start with name + truncated args preview', () => {
    const ev = mapEvent({
      event: 'on_tool_start',
      name: 'list_archive',
      data: { input: { archive: 'release.zip' } },
    });
    expect(ev?.kind).toBe('tool_start');
    if (ev?.kind === 'tool_start') {
      expect(ev.name).toBe('list_archive');
      expect(ev.argsPreview).toContain('release.zip');
    }
  });

  it('maps on_tool_end → tool_end with truncated result preview', () => {
    const ev = mapEvent({
      event: 'on_tool_end',
      data: { output: { entryCount: 42, totalUncompressedSize: 12345 } },
    });
    expect(ev?.kind).toBe('tool_end');
    if (ev?.kind === 'tool_end') {
      expect(ev.resultPreview).toContain('entryCount');
    }
  });

  it('truncates a very long tool result to ≤ 120 chars', () => {
    const giant = 'x'.repeat(500);
    const ev = mapEvent({ event: 'on_tool_end', data: { output: giant } });
    if (ev?.kind === 'tool_end') {
      expect(ev.resultPreview.length).toBeLessThanOrEqual(120);
    }
  });

  it('returns null for unknown events', () => {
    expect(mapEvent({ event: 'on_chain_start' })).toBeNull();
    expect(mapEvent({})).toBeNull();
  });
});

describe('stringifyContent', () => {
  it('handles plain strings', () => {
    expect(stringifyContent('foo')).toBe('foo');
  });
  it('handles array-of-parts (Anthropic shape)', () => {
    expect(stringifyContent([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }])).toBe('ab');
  });
  it('handles a single object with text field', () => {
    expect(stringifyContent({ text: 'x' })).toBe('x');
  });
  it('returns "" for nullish', () => {
    expect(stringifyContent(null)).toBe('');
    expect(stringifyContent(undefined)).toBe('');
  });
});
