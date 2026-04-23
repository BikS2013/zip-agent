import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import * as listCmd from '../../commands/list';
import { truncateToolResult } from './truncate';
import { handleToolError, type ToolAdapterFactory } from './types';

const schema = z.object({
  archive: z.string().min(1).describe('Path to the .zip archive (relative or absolute).'),
  justCount: z
    .boolean()
    .optional()
    .describe('When true, return only the entry count without the entries array.'),
});

export const createListTool: ToolAdapterFactory = (deps, cfg) =>
  tool(
    async (input) => {
      try {
        const result = await listCmd.run(
          deps,
          { archive: input.archive },
          { justCount: input.justCount },
        );
        return truncateToolResult(result, cfg.perToolBudgetBytes);
      } catch (err) {
        return handleToolError(err);
      }
    },
    {
      name: 'list_archive',
      description:
        'List the entries inside a zip archive (name, uncompressed size, modified time). ' +
        'Use this for the table-of-contents view. Set justCount=true if you only need the count.',
      schema,
    },
  );
