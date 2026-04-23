import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import * as addCmd from '../../commands/add';
import { truncateToolResult } from './truncate';
import { handleToolError, type ToolAdapterFactory } from './types';

const schema = z.object({
  archive: z.string().min(1).describe('Path of the existing .zip to update.'),
  files: z.array(z.string().min(1)).min(1).describe('File paths to add or update.'),
  recurse: z.boolean().optional().describe('Recurse into directories.'),
  password: z.string().optional().describe('Encrypt added entries with this password.'),
});

export const createAddTool: ToolAdapterFactory = (deps, cfg) =>
  tool(
    async (input) => {
      try {
        const result = await addCmd.run(
          deps,
          { archive: input.archive, files: input.files },
          { recurse: input.recurse, password: input.password },
        );
        return truncateToolResult(result, cfg.perToolBudgetBytes);
      } catch (err) {
        return handleToolError(err);
      }
    },
    {
      name: 'add_to_archive',
      description:
        '[MUTATING] Add new entries or update existing ones in a zip archive (`zip -u`). ' +
        'Returns {added, updated}.',
      schema,
    },
  );
