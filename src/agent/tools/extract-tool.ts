import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import * as extractCmd from '../../commands/extract';
import { truncateToolResult } from './truncate';
import { handleToolError, type ToolAdapterFactory } from './types';

const schema = z.object({
  archive: z.string().min(1).describe('Path of the .zip to extract.'),
  dest: z.string().optional().describe('Destination directory (default current working dir).'),
  password: z.string().optional().describe('Password if archive is encrypted.'),
  include: z
    .array(z.string())
    .optional()
    .describe('Only extract entries matching these patterns, e.g. ["docs/*"].'),
  force: z.boolean().optional().describe('Overwrite existing files (-o).'),
  noClobber: z.boolean().optional().describe('Refuse to overwrite (-n).'),
});

export const createExtractTool: ToolAdapterFactory = (deps, cfg) =>
  tool(
    async (input) => {
      try {
        const result = await extractCmd.run(
          deps,
          { archive: input.archive },
          {
            dest: input.dest,
            password: input.password,
            include: input.include ?? [],
            force: input.force,
            noClobber: input.noClobber,
          },
        );
        return truncateToolResult(result, cfg.perToolBudgetBytes);
      } catch (err) {
        return handleToolError(err);
      }
    },
    {
      name: 'extract_archive',
      description:
        '[MUTATING] Extract a zip archive into a destination directory (`unzip`). Confirm ' +
        'intent with the user before calling. If extraction collides with existing files and ' +
        'force is not set, the call returns a COLLISION error so you can ask the user to choose.',
      schema,
    },
  );
