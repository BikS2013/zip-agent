import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Dirent } from 'node:fs';
import { IoError, UsageError } from '../util/errors';
import { resolveUserPath } from '../util/paths';
import type { CommandDeps } from '../types';

export type FindType =
  | 'file'
  | 'dir'
  | 'symlink'
  | 'socket'
  | 'pipe'
  | 'block'
  | 'char'
  | 'unknown';

const TRAVERSABLE: ReadonlySet<FindType> = new Set(['dir']);

export interface FindArgs {
  /** Root path to search. Supports `~`, relative, absolute. */
  path: string;
}
export interface FindOptions {
  /** Filter to one or more entry types (OR). Omit for any type. */
  types?: FindType[];
  /** Glob applied to entry basename. `*` and `?` only. */
  name?: string;
  /** Max recursion depth. Default 20. Root is depth 0. */
  maxDepth?: number;
  /** Stop after this many matches. Default 500. */
  maxResults?: number;
  /** When true, recurse into hidden (dot-prefixed) directories. Default false. */
  includeHidden?: boolean;
  /** Skip these directory basenames entirely (e.g. ['node_modules', '.git']). */
  excludeDirs?: string[];
}

export interface FindEntry {
  path: string;
  type: FindType;
}

export interface FindResult {
  searchPath: string;
  matchCount: number;
  /** True when matchCount hit maxResults — caller should narrow. */
  truncated: boolean;
  matches: FindEntry[];
}

export async function run(
  deps: CommandDeps,
  args: FindArgs,
  opts: FindOptions = {},
): Promise<FindResult> {
  if (!args.path) throw new UsageError('find: <path> is required');
  const searchPath = resolveUserPath(deps.config.cwd, args.path);
  try {
    await fs.access(searchPath);
  } catch {
    throw new IoError(`find: path not found or unreadable: ${searchPath}`);
  }

  const maxDepth = opts.maxDepth ?? 20;
  const maxResults = opts.maxResults ?? 500;
  const allowedTypes = opts.types && opts.types.length > 0 ? new Set(opts.types) : null;
  const nameRe = opts.name ? globToRegex(opts.name) : null;
  const excludeDirs = new Set(opts.excludeDirs ?? []);
  const includeHidden = opts.includeHidden ?? false;

  const matches: FindEntry[] = [];

  // Iterative DFS to avoid Node call-stack limits on deep trees.
  type Frame = { dir: string; depth: number };
  const stack: Frame[] = [{ dir: searchPath, depth: 0 }];

  // Also test the root itself so a match like `find ~/foo -type d` returns
  // `~/foo` when it is itself a directory.
  await considerEntryAtPath(searchPath);

  while (stack.length > 0) {
    const { dir, depth } = stack.pop()!;
    if (depth >= maxDepth) continue;

    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      // Permission denied, broken symlink, race — skip silently.
      continue;
    }

    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      const type = direntType(ent);

      if (!includeHidden && ent.name.startsWith('.') && type === 'dir') {
        // Don't descend into hidden directories. Still allow the match
        // pass below to surface them if explicitly looked for.
      }
      const skipDescent =
        excludeDirs.has(ent.name) ||
        (!includeHidden && ent.name.startsWith('.') && type === 'dir');

      if (matchesFilter(ent.name, type, allowedTypes, nameRe)) {
        matches.push({ path: full, type });
        if (matches.length >= maxResults) {
          return { searchPath, matchCount: matches.length, truncated: true, matches };
        }
      }

      if (TRAVERSABLE.has(type) && !skipDescent) {
        stack.push({ dir: full, depth: depth + 1 });
      }
    }
  }

  return { searchPath, matchCount: matches.length, truncated: false, matches };

  // ---- inner helpers ------------------------------------------------

  async function considerEntryAtPath(p: string): Promise<void> {
    try {
      const st = await fs.lstat(p);
      const t = statType(st);
      const base = path.basename(p);
      if (matchesFilter(base, t, allowedTypes, nameRe)) {
        matches.push({ path: p, type: t });
        if (matches.length >= maxResults) {
          // Outer loop will detect.
        }
      }
    } catch {
      /* swallow */
    }
  }
}

function direntType(d: Dirent): FindType {
  if (d.isFile()) return 'file';
  if (d.isDirectory()) return 'dir';
  if (d.isSymbolicLink()) return 'symlink';
  if (d.isSocket()) return 'socket';
  if (d.isFIFO()) return 'pipe';
  if (d.isBlockDevice()) return 'block';
  if (d.isCharacterDevice()) return 'char';
  return 'unknown';
}

function statType(s: import('node:fs').Stats): FindType {
  if (s.isFile()) return 'file';
  if (s.isDirectory()) return 'dir';
  if (s.isSymbolicLink()) return 'symlink';
  if (s.isSocket()) return 'socket';
  if (s.isFIFO()) return 'pipe';
  if (s.isBlockDevice()) return 'block';
  if (s.isCharacterDevice()) return 'char';
  return 'unknown';
}

function matchesFilter(
  basename: string,
  type: FindType,
  allowedTypes: ReadonlySet<FindType> | null,
  nameRe: RegExp | null,
): boolean {
  if (allowedTypes && !allowedTypes.has(type)) return false;
  if (nameRe && !nameRe.test(basename)) return false;
  return true;
}

/**
 * Tiny glob → regex translator. Handles only the two characters needed in
 * practice (`*` matches any run, `?` matches one char). Other regex meta
 * characters are escaped. No `{a,b}` brace expansion, no `**` recursion —
 * recursion is the caller's job.
 */
export function globToRegex(glob: string): RegExp {
  let out = '';
  for (const c of glob) {
    if (c === '*') out += '.*';
    else if (c === '?') out += '.';
    else if ('.+()[]{}|^$\\/'.includes(c)) out += '\\' + c;
    else out += c;
  }
  return new RegExp(`^${out}$`);
}
