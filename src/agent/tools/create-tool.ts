import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import * as createCmd from '../../commands/create';
import { truncateToolResult } from './truncate';
import { handleToolError, type ToolAdapterFactory } from './types';

const schema = z.object({
  archive: z
    .string()
    .min(1)
    .describe('Path of the .zip to create. Supports `~` and `~/` for the user home directory.'),
  inputs: z
    .array(z.string().min(1))
    .min(1)
    .describe(
      'Files / directories to include. Supports `~` and `~/` for the user home directory; relative paths resolve against the agent cwd.',
    ),
  recurse: z.boolean().optional().describe('Recurse directories (default true).'),
  exclude: z
    .array(z.string())
    .optional()
    .describe('Glob patterns to exclude, e.g. ["*.DS_Store", "*.tmp"].'),
  password: z.string().optional().describe('Password for encryption (visible in process list).'),
  /** Default to idempotent for agent usage — see spec §17.9. */
  idempotent: z
    .boolean()
    .optional()
    .describe('When true (default for agent), recreate the archive if it already exists.'),
});

export const createCreateTool: ToolAdapterFactory = (deps, cfg) =>
  tool(
    async (input) => {
      try {
        const result = await createCmd.run(
          deps,
          { archive: input.archive, inputs: input.inputs },
          {
            recurse: input.recurse ?? true,
            exclude: input.exclude ?? [],
            password: input.password,
            idempotent: input.idempotent ?? true,
          },
        );
        return truncateToolResult(result, cfg.perToolBudgetBytes);
      } catch (err) {
        return handleToolError(err);
      }
    },
    {
      name: 'create_archive',
      description:
        '[MUTATING] Create a new zip archive from one or more input paths (`zip -r`). ' +
        'Confirm intent with the user before calling. Returns {filesAdded, bytesOut}.',
      schema,
    },
  );
