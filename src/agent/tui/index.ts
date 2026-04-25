/**
 * index.ts — public surface of the TUI module.
 *
 * Importers (currently just src/commands/agent.ts) only need
 * `runInteractiveTui`. Internal modules (input.ts, persistence.ts, etc.)
 * are also re-exported for the test suite under test_scripts/.
 */

export { runInteractiveTui } from './tui';
export type { RunInteractiveTuiArgs } from './tui';

// Re-exports useful to the test suite.
export {
  feedEscByte,
  insertNewline,
  insertText,
  handleBackspace,
  deleteForward,
  deleteToBol,
  deleteToEol,
  deleteWordBack,
  moveWordLeft,
  moveWordRight,
  makeEmptyEditorState,
  readInput,
  redrawCurrentLine,
  makeRenderState,
} from './input';
export { createUtf8Decoder } from './utf8';
export { createSpinner, SPINNER_FRAMES } from './spinner';
export { copyToClipboard, clipboardCandidates } from './clipboard';
export { mapEvent, stringifyContent } from './streaming';
export {
  ensureTuiBootstrap,
  memoryPath,
  lastResponsePath,
  tuiConfigPath,
  tuiHomePath,
  threadFile,
  threadsDir,
  readMemory,
  writeMemory,
  readTuiConfig,
  writeTuiConfig,
  saveTranscript,
  loadTranscript,
  listThreads,
  writeLastResponse,
} from './persistence';
export { dispatchSlash, findSlashCommand, SLASH_COMMANDS, generateThreadId } from './slash-commands';
