import type { CliConfig } from './config/config';
import type { ZipRunner } from './util/zip-runner';

export interface CommandLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export interface CommandDeps {
  readonly config: CliConfig;
  readonly zipRunner: ZipRunner;
  readonly now: () => Date;
  readonly logger: CommandLogger;
}
