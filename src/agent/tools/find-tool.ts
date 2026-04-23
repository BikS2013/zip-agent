import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import * as findCmd from '../../commands/find';
import { truncateToolResult } from './truncate';
import { handleToolError, type ToolAdapterFactory } from './types';

const FIND_TYPE_VALUES = [
  'file',
  'dir',
  'symlink',
  'socket',
  'pipe',
  'block',
  'char',
  'unknown',
] as const;

const schema = z.object({
  path: z
    .string()
    .min(1)
    .describe('Root directory to search. Supports `~`, `~/`, relative, and absolute paths.'),
  types: z
    .array(z.enum(FIND_TYPE_VALUES))
    .optional()
    .describe(
      'Filter to one or more entry types (OR-combined). ' +
        'Use ["socket", "pipe"] to find Unix sockets / FIFOs that zip cannot archive. ' +
        'Use ["file"] to find regular files only.',
    ),
  name: z
    .string()
    .optional()
    .describe('Glob applied to the entry basename. Only `*` and `?` wildcards. e.g. `*.sock`.'),
  maxDepth: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Max recursion depth from the search root. Default 20. Set to 1 to list immediate children only.'),
  maxResults: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('Stop after this many matches. Default 500.'),
  includeHidden: z
    .boolean()
    .optional()
    .describe('When true, recurse into hidden (dot-prefixed) directories. Default false.'),
  excludeDirs: z
    .array(z.string())
    .optional()
    .describe('Directory basenames to skip entirely (e.g. ["node_modules", ".git"]).'),
});

export const createFindTool: ToolAdapterFactory = (deps, cfg) =>
  tool(
    async (input) => {
      try {
        const result = await findCmd.run(
          deps,
          { path: input.path },
          {
            types: input.types,
            name: input.name,
            maxDepth: input.maxDepth,
            maxResults: input.maxResults,
            includeHidden: input.includeHidden,
            excludeDirs: input.excludeDirs ?? [],
          },
        );
        return truncateToolResult(result, cfg.perToolBudgetBytes);
      } catch (err) {
        return handleToolError(err);
      }
    },
    {
      name: 'find_files',
      description:
        'Search a directory tree and return matching paths with their type ' +
        '(file / dir / symlink / socket / pipe / ...). Read-only. ' +
        'Common uses: locate `socket`/`pipe` entries that prevent `zip` from running, ' +
        'or enumerate files matching a glob (`*.log`, `Dockerfile*`). ' +
        'When the result is `__truncated`, narrow with `name`, `types`, `excludeDirs`, ' +
        'or a smaller `maxDepth`.',
      schema,
    },
  );
