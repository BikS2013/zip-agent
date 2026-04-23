import type { StructuredToolInterface } from '@langchain/core/tools';
import type { CommandDeps } from '../../types';
import type { AgentConfig } from '../../config/agent-config';
import {
  AuthError,
  CollisionError,
  ConfigurationError,
  IoError,
  UpstreamError,
  UsageError,
} from '../../util/errors';

export type ToolAdapterFactory = (deps: CommandDeps, cfg: AgentConfig) => StructuredToolInterface;

/**
 * Recoverable errors are stringified into a JSON tool result so the model
 * can self-correct (try a different argument, narrow the query). Fatal
 * errors propagate to abort the graph and surface a non-zero CLI exit.
 */
export function handleToolError(err: unknown): string {
  if (err instanceof ConfigurationError) throw err;
  if (err instanceof AuthError) throw err;

  if (
    err instanceof UsageError ||
    err instanceof UpstreamError ||
    err instanceof IoError ||
    err instanceof CollisionError
  ) {
    return JSON.stringify({
      error: {
        code: err.code ?? 'UNKNOWN',
        message: err.message,
        httpStatus: err.httpStatus ?? null,
      },
    });
  }
  throw err;
}
