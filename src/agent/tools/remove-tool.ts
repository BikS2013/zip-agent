import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import * as removeCmd from '../../commands/remove';
import { truncateToolResult } from './truncate';
import { handleToolError, type ToolAdapterFactory } from './types';

const schema = z.object({
  archive: z.string().min(1).describe('Path of the .zip to modify.'),
  patterns: z
    .array(z.string().min(1))
    .min(1)
    .describe('Entry patterns to delete, e.g. ["*.tmp", "secrets/*"].'),
});

export const createRemoveTool: ToolAdapterFactory = (deps, cfg) =>
  tool(
    async (input) => {
      try {
        const result = await removeCmd.run(deps, {
          archive: input.archive,
          patterns: input.patterns,
        });
        return truncateToolResult(result, cfg.perToolBudgetBytes);
      } catch (err) {
        return handleToolError(err);
      }
    },
    {
      name: 'remove_from_archive',
      description:
        '[MUTATING] Delete entries from a zip archive (`zip -d`). Confirm intent before calling — ' +
        'patterns may match more than the user expects. Returns {removed: count}.',
      schema,
    },
  );
