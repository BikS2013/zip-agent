/**
 * ansi.ts — ANSI escape constants and small helpers used by the TUI.
 *
 * Kept separate so the rest of the TUI never inlines raw escape sequences,
 * and so test specs can import the same constants the production code emits.
 *
 * Source: spec §6 "Rendering primitives". No external dependencies.
 */

export const RESET = '\x1b[0m';
export const BOLD = '\x1b[1m';
export const DIM = '\x1b[2m';
export const GREEN = '\x1b[32m';
export const CYAN = '\x1b[36m';
export const YELLOW = '\x1b[33m';
export const RED = '\x1b[31m';

/** Clear the current terminal line and reset cursor to column 0. */
export const CLEAR_LINE = '\r\x1b[2K';

/** Move cursor up `n` rows. n=0 returns the empty string. */
export function cursorUp(n: number): string {
  return n > 0 ? `\x1b[${n}A` : '';
}

/** Move cursor down `n` rows. */
export function cursorDown(n: number): string {
  return n > 0 ? `\x1b[${n}B` : '';
}

/** Move cursor right `n` columns. */
export function cursorRight(n: number): string {
  return n > 0 ? `\x1b[${n}C` : '';
}

/** Move cursor left `n` columns. */
export function cursorLeft(n: number): string {
  return n > 0 ? `\x1b[${n}D` : '';
}

export const SAVE_CURSOR = '\x1b[s';
export const RESTORE_CURSOR = '\x1b[u';

/** Clear the entire screen and move the cursor to the top-left corner. */
export const CLEAR_SCREEN = '\x1b[2J\x1b[H';
