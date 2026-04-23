import type { Command } from 'commander';
import { loadCliConfig, type CliConfig, type OutputMode } from '../config/config';
import { redactString } from '../util/redact';
import { exitCodeFor } from '../util/exit-codes';
import { SpawnZipRunner } from '../util/zip-runner';
import type { CommandDeps, CommandLogger } from '../types';

export interface GlobalFlags {
  json?: boolean;
  table?: boolean;
  quiet?: boolean;
  verbose?: boolean;
  logFile?: string;
}

export interface ResolvedGlobals {
  config: CliConfig;
  outputMode: OutputMode;
  quiet: boolean;
  verbose: boolean;
}

export function resolveGlobals(program: Command): ResolvedGlobals {
  const opts = program.opts<GlobalFlags>();
  const outputMode: OutputMode = opts.table ? 'table' : 'json';
  const quiet = opts.quiet ?? false;
  const verbose = opts.verbose ?? false;
  const config = loadCliConfig(process.env, {
    outputMode,
    quiet,
    verbose,
    logFile: opts.logFile ?? null,
  });
  return { config, outputMode, quiet, verbose };
}

export function buildLogger(quiet: boolean): CommandLogger {
  const write = (label: string, msg: string): void => {
    if (quiet) return;
    process.stderr.write(`[zip-agent] ${label}: ${redactString(msg)}\n`);
  };
  return {
    info: (m) => write('info', m),
    warn: (m) => write('warn', m),
    error: (m) => write('error', m),
  };
}

export function buildDeps(globals: ResolvedGlobals): CommandDeps {
  return {
    config: globals.config,
    zipRunner: new SpawnZipRunner(),
    now: () => new Date(),
    logger: buildLogger(globals.quiet),
  };
}

/**
 * Wraps a command callback in error → exit-code translation. Commander
 * registers the returned function as the .action() handler.
 *
 * Commander v12 invokes actions with `(...positional, options, command)`,
 * so `options` is at `length - 2` and the trailing Command instance must
 * be discarded.
 */
export function makeAction<TOpts, TArgs extends unknown[]>(
  program: Command,
  fn: (deps: CommandDeps, globals: ResolvedGlobals, opts: TOpts, ...args: TArgs) => Promise<unknown>,
): (...args: unknown[]) => Promise<void> {
  return async (...allArgs) => {
    if (allArgs.length < 2) {
      throw new Error('makeAction: commander handler received fewer than 2 args.');
    }
    const opts = allArgs[allArgs.length - 2] as TOpts;
    const args = allArgs.slice(0, -2) as unknown as TArgs;
    const globals = resolveGlobals(program);
    const deps = buildDeps(globals);
    try {
      await fn(deps, globals, opts, ...args);
    } catch (err) {
      const code = exitCodeFor(err);
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`${redactString(`[zip-agent] error: ${message}`)}\n`);
      process.exit(code);
    }
  };
}
