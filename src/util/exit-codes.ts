import {
  AuthError,
  CliError,
  CollisionError,
  ConfigurationError,
  IoError,
  UpstreamError,
  UsageError,
} from './errors';

export const EXIT_OK = 0;
export const EXIT_UNEXPECTED = 1;
export const EXIT_USAGE = 2;
export const EXIT_CONFIG = 3;
export const EXIT_AUTH = 4;
export const EXIT_UPSTREAM = 5;
export const EXIT_IO = 6;
export const EXIT_COLLISION = 7;
export const EXIT_INTERRUPTED = 130;

export function exitCodeFor(err: unknown): number {
  if (err instanceof UsageError) return EXIT_USAGE;
  if (err instanceof ConfigurationError) return EXIT_CONFIG;
  if (err instanceof AuthError) return EXIT_AUTH;
  if (err instanceof UpstreamError) return EXIT_UPSTREAM;
  if (err instanceof IoError) return EXIT_IO;
  if (err instanceof CollisionError) return EXIT_COLLISION;
  if (err instanceof CliError) return EXIT_UNEXPECTED;
  return EXIT_UNEXPECTED;
}
