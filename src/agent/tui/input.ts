/**
 * input.ts — raw-mode multiline reader for the TUI.
 *
 * This is the single piece that everything else hangs off. It implements
 * the byte-level keyboard mapping from spec §5 verbatim, with two
 * non-negotiable details that have shipped broken on every previous bring-up
 * of this spec:
 *
 *   1. ESCAPE-SEQUENCE FRAMING (spec §5.1 / §18.1).
 *      A naïve "any byte in 0x40–0x7E terminates the sequence" heuristic
 *      treats the CSI introducer `[` (0x5B) and SS3 introducer `O` (0x4F)
 *      as terminators, because both fall in that range. Result: `\x1b[A`
 *      gets dispatched at `[`, the `A` then leaks through the printable
 *      path, and arrow keys echo as the literal letter. The fix is to
 *      frame by SHAPE, not by final-byte:
 *
 *        \x1b[ … FINAL    →  CSI; final-byte must come AFTER the `[`,
 *                            length ≥ 3.
 *        \x1bO<key>       →  SS3; dispatch at exactly 3 bytes.
 *        \x1b<char>       →  ESC-prefixed; dispatch at exactly 2 bytes.
 *        lone \x1b        →  hold buffer; await next byte.
 *
 *   2. STATEFUL UTF-8 DECODING (spec §5.2 / §18.2).
 *      Every printable byte (≥ 0x20, ≠ 0x7F, not currently inside an
 *      escape sequence) must flow through a stateful UTF-8 decoder. The
 *      decoder buffers partial sequences across bytes and across `data`
 *      events. Calling `String.fromCharCode(b)` on each byte instead
 *      produces Latin-1 mojibake (Greek "Αναφορά" → "ÎÎ½Î±ÏÎ¿ÏÎ¬").
 *
 * Both behaviours are protected by mandatory regression specs in
 * test_scripts/tui-input-escape-framing.spec.ts and tui-input-utf8.spec.ts.
 *
 * The reader is an ESM-style closure that owns one editor state per call.
 * It returns the joined `lines.join("\n")` on Enter, rejects with
 * `"SIGINT"` on Ctrl+C during edit, and rejects with `"EOF"` on Ctrl+D on
 * an empty buffer.
 */

import { CLEAR_LINE, GREEN, RESET } from './ansi';
import { createUtf8Decoder } from './utf8';

export interface ReadInputOptions {
  prompt: string;
  continuationPrompt: string;
  inputHistory: string[];
  stdin?: NodeJS.ReadStream;
  stdout?: NodeJS.WritableStream;
}

// ---------------------------------------------------------------------------
// Pure helpers — exported for unit testing per spec §14.
// ---------------------------------------------------------------------------

export interface EditorState {
  /** All lines of the in-progress input. Always at least one element. */
  lines: string[];
  /** Index into `lines` of the line the cursor is on. */
  row: number;
  /** Column of the cursor on `lines[row]`. 0..lines[row].length. */
  col: number;
}

export function makeEmptyEditorState(): EditorState {
  return { lines: [''], row: 0, col: 0 };
}

/** Replace the entire editor buffer with a single line of text. */
export function replaceInput(state: EditorState, text: string): EditorState {
  // text may itself contain newlines (e.g. when loaded from history that was
  // submitted as multi-line). Preserve them.
  const lines = text.split('\n');
  const lastIdx = lines.length - 1;
  return {
    lines,
    row: lastIdx,
    col: lines[lastIdx]!.length,
  };
}

/** Insert a newline at the cursor, splitting the current line. */
export function insertNewline(state: EditorState): EditorState {
  const cur = state.lines[state.row]!;
  const before = cur.slice(0, state.col);
  const after = cur.slice(state.col);
  const newLines = [...state.lines];
  newLines.splice(state.row, 1, before, after);
  return { lines: newLines, row: state.row + 1, col: 0 };
}

/**
 * Backspace: delete the char before the cursor, or merge with the previous
 * line if the cursor is at column 0.
 */
export function handleBackspace(state: EditorState): EditorState {
  if (state.col > 0) {
    const cur = state.lines[state.row]!;
    const next = cur.slice(0, state.col - 1) + cur.slice(state.col);
    const lines = [...state.lines];
    lines[state.row] = next;
    return { lines, row: state.row, col: state.col - 1 };
  }
  if (state.row === 0) return state; // nothing to merge into
  const prev = state.lines[state.row - 1]!;
  const cur = state.lines[state.row]!;
  const merged = prev + cur;
  const lines = [...state.lines];
  lines.splice(state.row - 1, 2, merged);
  return { lines, row: state.row - 1, col: prev.length };
}

/** Insert a string (one or more code points) at the cursor. */
export function insertText(state: EditorState, text: string): EditorState {
  if (text.length === 0) return state;
  const cur = state.lines[state.row]!;
  const next = cur.slice(0, state.col) + text + cur.slice(state.col);
  const lines = [...state.lines];
  lines[state.row] = next;
  // Use spread+length to advance by code-point count, not UTF-16 unit count,
  // so a 4-byte emoji counts as a single visible character.
  const advance = [...text].length;
  return { lines, row: state.row, col: state.col + advance };
}

/** Delete the character at (or after) the cursor. */
export function deleteForward(state: EditorState): EditorState {
  const cur = state.lines[state.row]!;
  if (state.col < cur.length) {
    const next = cur.slice(0, state.col) + cur.slice(state.col + 1);
    const lines = [...state.lines];
    lines[state.row] = next;
    return { lines, row: state.row, col: state.col };
  }
  // At end of line: merge next line into this one.
  if (state.row + 1 >= state.lines.length) return state;
  const merged = cur + state.lines[state.row + 1]!;
  const lines = [...state.lines];
  lines.splice(state.row, 2, merged);
  return { lines, row: state.row, col: state.col };
}

const WORD_RE = /[A-Za-z0-9_]/;

/** Word-aware backspace (Ctrl+W / Alt+Backspace). */
export function deleteWordBack(state: EditorState): EditorState {
  if (state.col === 0) return handleBackspace(state);
  const cur = state.lines[state.row]!;
  let i = state.col;
  // Skip trailing whitespace.
  while (i > 0 && !WORD_RE.test(cur[i - 1]!)) i -= 1;
  // Then skip the word characters.
  while (i > 0 && WORD_RE.test(cur[i - 1]!)) i -= 1;
  const next = cur.slice(0, i) + cur.slice(state.col);
  const lines = [...state.lines];
  lines[state.row] = next;
  return { lines, row: state.row, col: i };
}

/** Delete from cursor to end of line. */
export function deleteToEol(state: EditorState): EditorState {
  const cur = state.lines[state.row]!;
  if (state.col >= cur.length) return state;
  const lines = [...state.lines];
  lines[state.row] = cur.slice(0, state.col);
  return { lines, row: state.row, col: state.col };
}

/** Delete from cursor to start of line. */
export function deleteToBol(state: EditorState): EditorState {
  if (state.col === 0) return state;
  const cur = state.lines[state.row]!;
  const lines = [...state.lines];
  lines[state.row] = cur.slice(state.col);
  return { lines, row: state.row, col: 0 };
}

/** Move cursor one word left. */
export function moveWordLeft(state: EditorState): EditorState {
  if (state.col === 0) {
    if (state.row === 0) return state;
    return { ...state, row: state.row - 1, col: state.lines[state.row - 1]!.length };
  }
  const cur = state.lines[state.row]!;
  let i = state.col;
  while (i > 0 && !WORD_RE.test(cur[i - 1]!)) i -= 1;
  while (i > 0 && WORD_RE.test(cur[i - 1]!)) i -= 1;
  return { ...state, col: i };
}

/** Move cursor one word right. */
export function moveWordRight(state: EditorState): EditorState {
  const cur = state.lines[state.row]!;
  if (state.col >= cur.length) {
    if (state.row + 1 >= state.lines.length) return state;
    return { ...state, row: state.row + 1, col: 0 };
  }
  let i = state.col;
  while (i < cur.length && !WORD_RE.test(cur[i]!)) i += 1;
  while (i < cur.length && WORD_RE.test(cur[i]!)) i += 1;
  return { ...state, col: i };
}

// ---------------------------------------------------------------------------
// Renderer — translates EditorState into ANSI writes against an output stream.
// ---------------------------------------------------------------------------

export interface RenderState {
  /** Number of rows the previous render produced. */
  drawnRows: number;
  /** Cursor row from the top of the rendered block. */
  cursorRow: number;
}

export function makeRenderState(): RenderState {
  return { drawnRows: 0, cursorRow: 0 };
}

/**
 * Re-paint the editor to the output stream. Erases whatever was previously
 * drawn (`prev.drawnRows`) then writes prompt + each line. Returns the new
 * RenderState describing what's now on screen.
 *
 * This is a single-shot whole-block rewrite — simpler than diff-rendering
 * and indistinguishable to the user at typing speed.
 */
export function redrawCurrentLine(
  out: NodeJS.WritableStream,
  prev: RenderState,
  state: EditorState,
  prompt: string,
  continuationPrompt: string,
): RenderState {
  // Move cursor to the top of the previously-rendered block, then clear
  // each row before re-emitting. Using the explicit row count avoids
  // ambiguity when the terminal has soft-wrapped a long line — the next
  // rewrite paints over the soft wraps too.
  let header = '';
  if (prev.drawnRows > 0) {
    // Move cursor back up to the first row of the block.
    if (prev.cursorRow > 0) header += `\x1b[${prev.cursorRow}A`;
    header += CLEAR_LINE;
    for (let i = 1; i < prev.drawnRows; i += 1) {
      header += `\n${CLEAR_LINE}`;
    }
    // After the loop the cursor is on the last cleared row; move back up
    // to row 0.
    if (prev.drawnRows > 1) header += `\x1b[${prev.drawnRows - 1}A`;
  }
  out.write(header);

  // Emit the prompt + lines.
  let buf = '';
  for (let i = 0; i < state.lines.length; i += 1) {
    const p = i === 0 ? prompt : continuationPrompt;
    if (i > 0) buf += '\n';
    buf += p + state.lines[i]!;
  }
  out.write(buf);

  // Move the cursor to (state.row, state.col + prompt-width).
  const lastRow = state.lines.length - 1;
  const upBy = lastRow - state.row;
  const promptWidth = visibleLength(state.row === 0 ? prompt : continuationPrompt);
  // After writing, the cursor is at the end of the last line.
  // First step: go back to column 0, then go up by (lastRow - state.row),
  // then move right by (promptWidth + state.col code-units).
  let trail = '\r';
  if (upBy > 0) trail += `\x1b[${upBy}A`;
  const targetCol = promptWidth + visibleColumnFor(state.lines[state.row]!, state.col);
  if (targetCol > 0) trail += `\x1b[${targetCol}C`;
  out.write(trail);

  return { drawnRows: state.lines.length, cursorRow: state.row };
}

/** Length of a string without ANSI escape sequences. */
function visibleLength(s: string): number {
  // Strip CSI/SGR sequences. Cheap regex: \x1b\[[\d;]*m
  // (We use it here because the prompt strings contain colour codes.)
  // Use code-point count (spread) so emoji-laden prompts measure right.
  return [...s.replace(/\x1b\[[\d;]*[A-Za-z]/g, '')].length;
}

/** Column the cursor occupies given a code-unit index into the source line. */
function visibleColumnFor(line: string, codeUnitIdx: number): number {
  // Convert UTF-16 code-unit index → display column (= code-point count).
  // We slice up to the JS-string index then count code points by spread.
  return [...line.slice(0, codeUnitIdx)].length;
}

// ---------------------------------------------------------------------------
// Escape-sequence framing (spec §5.1) — DO NOT REGRESS.
// ---------------------------------------------------------------------------

const MAX_ESC_BUFFER = 10;

/** Frame state for an in-flight escape sequence. */
type EscState =
  | { kind: 'idle' }
  /** Saw \x1b alone, awaiting next byte. */
  | { kind: 'esc'; bytes: number[] }
  /** Saw \x1b[ — accumulating CSI parameter bytes; final-byte ends it. */
  | { kind: 'csi'; bytes: number[] }
  /** Saw \x1bO — awaiting one more byte. */
  | { kind: 'ss3'; bytes: number[] };

/**
 * Decide what to do with the next byte given the escape-frame state.
 *
 * Returns one of:
 *   - { action: 'continue', state }      keep accumulating, no dispatch
 *   - { action: 'dispatch', sequence }   complete sequence (string of bytes)
 *   - { action: 'discard' }              buffer overran or is invalid
 *   - { action: 'passthrough', byte }    not in a sequence, give to printable path
 *
 * Pure function — exported so the framing rules are testable in isolation
 * without spinning up a full reader.
 */
export type EscFrameResult =
  | { action: 'continue'; state: EscState }
  | { action: 'dispatch'; state: EscState; sequence: string }
  | { action: 'discard'; state: EscState }
  | { action: 'passthrough'; state: EscState; byte: number };

export function feedEscByte(state: EscState, byte: number): EscFrameResult {
  // Idle: a 0x1B opens a new sequence, anything else is a passthrough.
  if (state.kind === 'idle') {
    if (byte === 0x1b) {
      return { action: 'continue', state: { kind: 'esc', bytes: [0x1b] } };
    }
    return { action: 'passthrough', state, byte };
  }

  // Already accumulating. Apply per-shape rules.
  const newBytes = [...state.bytes, byte];

  // Safety cap: discard absurdly long sequences (likely paste of binary garbage).
  if (newBytes.length > MAX_ESC_BUFFER) {
    return { action: 'discard', state: { kind: 'idle' } };
  }

  if (state.kind === 'esc') {
    // We have just \x1b. The next byte determines the shape.
    if (byte === 0x5b /* '[' */) {
      return { action: 'continue', state: { kind: 'csi', bytes: newBytes } };
    }
    if (byte === 0x4f /* 'O' */) {
      return { action: 'continue', state: { kind: 'ss3', bytes: newBytes } };
    }
    // ESC + <single char> (Alt+b, Alt+f, Alt+Backspace, ESC+\r, ESC+\n).
    // Dispatch at exactly 2 bytes.
    return {
      action: 'dispatch',
      state: { kind: 'idle' },
      sequence: bytesToString(newBytes),
    };
  }

  if (state.kind === 'ss3') {
    // SS3 is exactly 3 bytes. We came in with 2 (ESC, 'O'); this byte completes it.
    return {
      action: 'dispatch',
      state: { kind: 'idle' },
      sequence: bytesToString(newBytes),
    };
  }

  // CSI: \x1b[ <params/intermediates> <final>. The final byte sits in
  // 0x40..0x7E. CRITICAL: this check applies to bytes that arrive AFTER
  // the `[` introducer, never to the introducer itself. The condition
  // `state.bytes.length >= 2` guarantees that — when we entered this branch
  // we already have at least \x1b and `[` accumulated, so newBytes.length
  // is at least 3 and `byte` is the first parameter/final byte.
  if (state.kind === 'csi') {
    if (byte >= 0x40 && byte <= 0x7e) {
      return {
        action: 'dispatch',
        state: { kind: 'idle' },
        sequence: bytesToString(newBytes),
      };
    }
    // Parameter / intermediate byte — keep accumulating.
    return { action: 'continue', state: { kind: 'csi', bytes: newBytes } };
  }

  // Unreachable; satisfy exhaustiveness.
  /* c8 ignore next */
  return { action: 'discard', state: { kind: 'idle' } };
}

function bytesToString(bs: number[]): string {
  return Buffer.from(bs).toString('binary');
}

// ---------------------------------------------------------------------------
// Reader — async function that returns the next user input.
// ---------------------------------------------------------------------------

/**
 * The main raw-mode reader. Returns a Promise that resolves with the
 * submitted text on Enter, rejects with `"SIGINT"` on Ctrl+C, or rejects
 * with `"EOF"` on Ctrl+D on an empty buffer. Uses raw stdin and direct
 * ANSI writes — never `readline`.
 */
export function readInput(opts: ReadInputOptions): Promise<string> {
  const stdin = opts.stdin ?? (process.stdin as NodeJS.ReadStream);
  const out = opts.stdout ?? process.stdout;
  const { prompt, continuationPrompt } = opts;
  const inputHistory = opts.inputHistory;

  return new Promise<string>((resolve, reject) => {
    let editor = makeEmptyEditorState();
    let render = makeRenderState();
    let escState: EscState = { kind: 'idle' };
    const decoder = createUtf8Decoder();

    /**
     * Index into inputHistory pointing at the entry currently shown. -1 means
     * "no history entry — show whatever the user is typing".
     */
    let historyIdx = -1;
    let savedDraft = '';

    const isTty = !!stdin.isTTY;
    if (isTty && typeof stdin.setRawMode === 'function') {
      stdin.setRawMode(true);
    }
    stdin.resume();

    // Initial paint — show the prompt with empty buffer.
    render = redrawCurrentLine(out, render, editor, prompt, continuationPrompt);

    const setEditor = (next: EditorState): void => {
      editor = next;
      render = redrawCurrentLine(out, render, editor, prompt, continuationPrompt);
    };

    const cleanup = (): void => {
      stdin.off('data', onData);
      if (isTty && typeof stdin.setRawMode === 'function') {
        stdin.setRawMode(false);
      }
      stdin.pause();
    };

    const finishWith = (text: string): void => {
      cleanup();
      // Move cursor past the rendered block so the next output starts on
      // a fresh line.
      out.write('\n');
      resolve(text);
    };

    const failWith = (reason: string): void => {
      cleanup();
      out.write('\n');
      reject(new Error(reason));
    };

    const handleSubmit = (): void => {
      const text = editor.lines.join('\n');
      finishWith(text);
    };

    const navHistory = (direction: -1 | 1): void => {
      if (inputHistory.length === 0) return;
      if (historyIdx === -1) {
        // First time entering history — save the user's current draft so
        // returning past the bottom restores it.
        savedDraft = editor.lines.join('\n');
        if (direction === -1) {
          historyIdx = inputHistory.length - 1;
          setEditor(replaceInput(editor, inputHistory[historyIdx]!));
        }
        // (direction === +1 from -1 is a no-op — already at "bottom".)
        return;
      }
      const next = historyIdx + direction;
      if (next < 0) return; // already at oldest
      if (next >= inputHistory.length) {
        // Past the newest — restore the saved draft.
        historyIdx = -1;
        setEditor(replaceInput(editor, savedDraft));
        return;
      }
      historyIdx = next;
      setEditor(replaceInput(editor, inputHistory[historyIdx]!));
    };

    /**
     * Dispatch a fully-framed escape sequence to the appropriate editor
     * action. Unknown sequences are silently dropped — never fed back into
     * the printable-byte path (spec §5.1).
     */
    const handleEscape = (seq: string): void => {
      switch (seq) {
        // Arrow keys.
        case '\x1b[A': // up
          if (editor.row > 0) {
            const target = editor.lines[editor.row - 1]!;
            setEditor({
              ...editor,
              row: editor.row - 1,
              col: Math.min(editor.col, target.length),
            });
          } else {
            navHistory(-1);
          }
          return;
        case '\x1b[B': // down
          if (editor.row < editor.lines.length - 1) {
            const target = editor.lines[editor.row + 1]!;
            setEditor({
              ...editor,
              row: editor.row + 1,
              col: Math.min(editor.col, target.length),
            });
          } else {
            navHistory(+1);
          }
          return;
        case '\x1b[C': // right
          {
            const cur = editor.lines[editor.row]!;
            if (editor.col < cur.length) {
              setEditor({ ...editor, col: editor.col + 1 });
            } else if (editor.row + 1 < editor.lines.length) {
              setEditor({ ...editor, row: editor.row + 1, col: 0 });
            }
          }
          return;
        case '\x1b[D': // left
          if (editor.col > 0) {
            setEditor({ ...editor, col: editor.col - 1 });
          } else if (editor.row > 0) {
            setEditor({
              ...editor,
              row: editor.row - 1,
              col: editor.lines[editor.row - 1]!.length,
            });
          }
          return;

        // Home/End in their many encodings.
        case '\x1b[H':
        case '\x1b[1~':
        case '\x1bOH':
        case '\x1b[1;9D': // iTerm Cmd+Left
        case '\x1b[1;2H':
          setEditor({ ...editor, col: 0 });
          return;
        case '\x1b[F':
        case '\x1b[4~':
        case '\x1bOF':
        case '\x1b[1;9C': // iTerm Cmd+Right
        case '\x1b[1;2F':
          setEditor({ ...editor, col: editor.lines[editor.row]!.length });
          return;

        // Word motion.
        case '\x1b[1;3D': // Option+Left
        case '\x1b[1;5D': // Ctrl+Left
        case '\x1bb': // Alt+b
          setEditor(moveWordLeft(editor));
          return;
        case '\x1b[1;3C': // Option+Right
        case '\x1b[1;5C': // Ctrl+Right
        case '\x1bf': // Alt+f
          setEditor(moveWordRight(editor));
          return;

        // Delete key + Cmd+Backspace.
        case '\x1b[3~':
          setEditor(deleteForward(editor));
          return;
        case '\x1b[3;9~':
          setEditor(deleteToBol(editor));
          return;
        case '\x1b\x7f': // Alt+Backspace
          setEditor(deleteWordBack(editor));
          return;

        // Shift+Enter variants.
        case '\x1b[13;2u':
        case '\x1bOM':
        case '\x1b\r':
        case '\x1b\n':
        case '\x1b[27;2;13~':
          setEditor(insertNewline(editor));
          return;

        default:
          // Unknown — drop silently per spec §5.1.
          return;
      }
    };

    const onData = (data: Buffer): void => {
      for (let i = 0; i < data.length; i += 1) {
        const b = data[i]!;
        const r = feedEscByte(escState, b);
        escState = r.state;

        if (r.action === 'continue' || r.action === 'discard') {
          continue;
        }

        if (r.action === 'dispatch') {
          handleEscape(r.sequence);
          continue;
        }

        // r.action === 'passthrough'. Map control bytes; route printables
        // through the UTF-8 decoder.
        const byte = r.byte;

        // Ctrl+C — abort the read.
        if (byte === 0x03) {
          failWith('SIGINT');
          return;
        }
        // Ctrl+D — exit on empty buffer; ignored otherwise.
        if (byte === 0x04) {
          if (editor.lines.length === 1 && editor.lines[0]!.length === 0) {
            failWith('EOF');
            return;
          }
          continue;
        }
        // Enter (CR) — submit.
        if (byte === 0x0d) {
          handleSubmit();
          return;
        }
        // Ctrl+J / LF — insert newline (universal Shift+Enter fallback).
        if (byte === 0x0a) {
          setEditor(insertNewline(editor));
          continue;
        }
        // Backspace.
        if (byte === 0x7f || byte === 0x08) {
          setEditor(handleBackspace(editor));
          continue;
        }
        // Ctrl+A / Ctrl+E.
        if (byte === 0x01) {
          setEditor({ ...editor, col: 0 });
          continue;
        }
        if (byte === 0x05) {
          setEditor({ ...editor, col: editor.lines[editor.row]!.length });
          continue;
        }
        // Ctrl+K / Ctrl+U.
        if (byte === 0x0b) {
          setEditor(deleteToEol(editor));
          continue;
        }
        if (byte === 0x15) {
          setEditor(deleteToBol(editor));
          continue;
        }
        // Ctrl+W.
        if (byte === 0x17) {
          setEditor(deleteWordBack(editor));
          continue;
        }
        // Ctrl+L — clear screen and redraw.
        if (byte === 0x0c) {
          out.write('\x1b[2J\x1b[H');
          render = makeRenderState();
          render = redrawCurrentLine(out, render, editor, prompt, continuationPrompt);
          continue;
        }
        // Other low control bytes — ignore.
        if (byte < 0x20) continue;
        // 0x7F is handled above; all other bytes ≥ 0x20 are printable.
        // Route through the stateful UTF-8 decoder. Multi-byte sequences
        // may split across data events; the decoder buffers them.
        const ch = decoder.write(byte);
        if (ch.length > 0) {
          setEditor(insertText(editor, ch));
        }
      }
    };

    stdin.on('data', onData);
  });
}

// ---------------------------------------------------------------------------
// Default prompts
// ---------------------------------------------------------------------------

export const DEFAULT_PROMPT = `${GREEN}You>${RESET} `;
export const DEFAULT_CONTINUATION_PROMPT = `${GREEN} ..${RESET} `;
