import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import * as infoCmd from '../../commands/info';
import { truncateToolResult } from './truncate';
import { handleToolError, type ToolAdapterFactory } from './types';

const schema = z.object({
  archive: z.string().min(1).describe('Path to the .zip archive.'),
  verboseInfo: z
    .boolean()
    .optional()
    .describe('When true (default), pass -v for verbose per-entry info.'),
});

export const createInfoTool: ToolAdapterFactory = (deps, cfg) =>
  tool(
    async (input) => {
      try {
        const result = await infoCmd.run(
          deps,
          { archive: input.archive },
          { verboseInfo: input.verboseInfo },
        );
        return truncateToolResult(result, cfg.perToolBudgetBytes);
      } catch (err) {
        return handleToolError(err);
      }
    },
    {
      name: 'archive_info',
      description:
        'Get detailed metadata about a zip archive using `zipinfo -v`. Returns the raw zipinfo ' +
        'output plus parsed header and entry count. Heavier than list_archive — use only when ' +
        'the user needs entry-level detail beyond name/size.',
      schema,
    },
  );
