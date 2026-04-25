/**
 * env-loader.ts — layered environment builder for the agent subcommand.
 *
 * Precedence chain (highest to lowest):
 *
 *   1. --env-file <path>  (when provided, REPLACES both file sources below;
 *                          the chain becomes: --env-file > process.env > defaults)
 *   2. CLI flags           (handled downstream by loadAgentConfig; not here)
 *   3. ./.env              (project-local, cwd; wins over global config)
 *   4. ~/.tool-agents/zip-agent/config  (global per-tool; dotenv KEY=VALUE file)
 *   5. process.env         (existing shell exports; lowest before built-in defaults)
 *   6. NONE → ConfigurationError for required; built-in defaults for tunables
 *
 * Implementation: we build an explicit merged object rather than mutating
 * process.env. Object.assign / spread is applied LAST-WINS:
 *
 *   { ...processEnv, ...globalConfig, ...localDotenv, ...envFile? }
 *
 * The result is passed to loadAgentConfig as its `env` argument.
 *
 * IMPORTANT: This is an unusual precedence where dotenv file sources outrank
 * process.env. See ADR-008 in project-design.md for the rationale.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';
import { GLOBAL_CONFIG_TEMPLATE } from './global-config-template';

/** Path to the global per-tool config file. */
export const GLOBAL_CONFIG_PATH = path.join(os.homedir(), '.tool-agents', 'zip-agent', 'config');

/** Result of attempting to bootstrap the global per-tool config file. */
export interface BootstrapResult {
  /** Absolute path that was checked / written. */
  readonly path: string;
  /** True only when the file did not exist and was just created. */
  readonly created: boolean;
  /**
   * Non-fatal warning. Set when the bootstrap could not write the file
   * (e.g. permission denied) or could not create the parent directory.
   * The caller should surface this on stderr but continue — the agent can
   * still run, the global config layer is just unavailable.
   */
  readonly warning?: string;
}

/**
 * Ensure `~/.tool-agents/zip-agent/config` exists, creating the directory
 * tree and seeding the file with the embedded template (a copy of
 * `.env.example`, fully commented out) when absent. Idempotent: when the
 * file already exists this is a cheap stat call and returns
 * `created: false`.
 *
 * Failures (permission denied, ENOSPC, etc.) are NOT thrown — the caller
 * gets a `warning` to print and the agent continues. The global-config
 * layer simply contributes no values for that invocation.
 *
 * @param opts.configPath  Override the destination path. Used by tests to
 *                         point at a tmpdir-based fake home directory; in
 *                         production callers should omit it so the constant
 *                         `GLOBAL_CONFIG_PATH` is used.
 */
export function ensureGlobalConfigFile(
  opts: { configPath?: string } = {},
): BootstrapResult {
  const target = opts.configPath ?? GLOBAL_CONFIG_PATH;

  if (fs.existsSync(target)) {
    return { path: target, created: false };
  }

  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, GLOBAL_CONFIG_TEMPLATE, { encoding: 'utf8', flag: 'wx' });
    return { path: target, created: true };
  } catch (err) {
    // EEXIST means another process raced us between existsSync and writeFile
    // with flag 'wx'. Treat that as already-existing, not as a failure.
    if (err && typeof err === 'object' && 'code' in err && err.code === 'EEXIST') {
      return { path: target, created: false };
    }
    const message = err instanceof Error ? err.message : String(err);
    return {
      path: target,
      created: false,
      warning: `could not bootstrap global config at ${target}: ${message}`,
    };
  }
}

/**
 * Read a dotenv-style KEY=VALUE file and return the parsed key/value pairs.
 * Returns an empty object if the file does not exist or cannot be read.
 * Never throws — a missing or unreadable file is silently ignored.
 */
export function readDotenvFile(filePath: string): Record<string, string> {
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    // File absent or unreadable — treat as empty.
    return {};
  }
  const result = dotenv.parse(content);
  // dotenv.parse returns Record<string, string> — no undefined values.
  return result;
}

/**
 * Build the effective environment map used by loadAgentConfig.
 *
 * @param options.envFile  Path supplied via --env-file. When set, replaces
 *                         both ./.env and ~/.tool-agents/zip-agent/config.
 * @param options.cwd      Working directory for resolving './.env'.
 *                         Defaults to process.cwd().
 */
export function buildEffectiveEnv(options: {
  envFile?: string;
  cwd?: string;
}): NodeJS.ProcessEnv {
  const { envFile, cwd = process.cwd() } = options;

  if (envFile) {
    // --env-file replaces both file sources. Chain: envFile > process.env.
    const fileVars = readDotenvFile(envFile);
    return { ...process.env, ...fileVars };
  }

  // Normal layered resolution:
  //   process.env (lowest) → global config → local .env (highest file source)
  const globalVars = readDotenvFile(GLOBAL_CONFIG_PATH);
  const localVars = readDotenvFile(path.join(cwd, '.env'));

  return {
    ...process.env,
    ...globalVars,
    ...localVars,
  };
}
