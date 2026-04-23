/**
 * CLI-level (non-agent) configuration. Resolves binary paths and global
 * output options from process env. Only optional knobs have defaults; the
 * binary names default to the unqualified command (resolved via $PATH).
 */
export type OutputMode = 'json' | 'table';

export interface CliConfig {
  readonly zipBin: string;
  readonly unzipBin: string;
  readonly zipinfoBin: string;
  readonly logFile: string | null;
  readonly outputMode: OutputMode;
  readonly quiet: boolean;
  readonly verbose: boolean;
  readonly cwd: string;
}

export interface CliConfigOverrides {
  outputMode?: OutputMode;
  quiet?: boolean;
  verbose?: boolean;
  logFile?: string | null;
  cwd?: string;
}

export function loadCliConfig(env: NodeJS.ProcessEnv, o: CliConfigOverrides = {}): CliConfig {
  return Object.freeze({
    zipBin: env['ZIP_AGENT_ZIP_BIN'] ?? 'zip',
    unzipBin: env['ZIP_AGENT_UNZIP_BIN'] ?? 'unzip',
    zipinfoBin: env['ZIP_AGENT_ZIPINFO_BIN'] ?? 'zipinfo',
    logFile: o.logFile ?? env['ZIP_AGENT_LOG_FILE'] ?? null,
    outputMode: o.outputMode ?? 'json',
    quiet: o.quiet ?? false,
    verbose: o.verbose ?? false,
    cwd: o.cwd ?? process.cwd(),
  });
}
