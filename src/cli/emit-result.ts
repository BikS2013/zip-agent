import type { OutputMode } from '../config/config';

export function emitResult(value: unknown, mode: OutputMode = 'json'): void {
  if (mode === 'table') {
    if (Array.isArray(value)) {
      // eslint-disable-next-line no-console
      console.table(value);
      return;
    }
    if (value && typeof value === 'object') {
      // eslint-disable-next-line no-console
      console.table(value as Record<string, unknown>);
      return;
    }
  }
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}
