import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import * as testCmd from '../../commands/test';
import { truncateToolResult } from './truncate';
import { handleToolError, type ToolAdapterFactory } from './types';

const schema = z.object({
  archive: z.string().min(1).describe('Path to the .zip archive.'),
});

export const createTestTool: ToolAdapterFactory = (deps, cfg) =>
  tool(
    async (input) => {
      try {
        const result = await testCmd.run(deps, { archive: input.archive });
        return truncateToolResult(result, cfg.perToolBudgetBytes);
      } catch (err) {
        return handleToolError(err);
      }
    },
    {
      name: 'test_archive',
      description:
        'Verify the integrity of a zip archive (`unzip -t`). Returns {ok, errors[]}. ' +
        'Use this when the user asks "is this archive corrupted?" or before extracting an ' +
        'untrusted file.',
      schema,
    },
  );
