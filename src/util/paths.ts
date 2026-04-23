import os from 'node:os';
import path from 'node:path';

/**
 * Resolve a user-supplied path the way a shell would. Three behaviors
 * combined into one:
 *
 *   - "~"        → os.homedir()
 *   - "~/foo/b"  → path.resolve(os.homedir(), "foo/b")
 *   - "foo/b"    → path.resolve(cwd, "foo/b")  (default Node behavior)
 *   - "/abs/p"   → "/abs/p"                    (absolute paths untouched)
 *
 * `child_process.spawn` does NOT expand `~` because no shell is involved,
 * so every command module must funnel user-supplied paths through this
 * helper before passing them to the OS zip/unzip binaries.
 */
export function resolveUserPath(cwd: string, p: string): string {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    return path.resolve(os.homedir(), p.slice(2));
  }
  return path.resolve(cwd, p);
}
