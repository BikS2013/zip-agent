import type { StructuredToolInterface } from '@langchain/core/tools';
import type { CommandDeps } from '../../types';
import type { AgentConfig } from '../../config/agent-config';
import { UsageError } from '../../util/errors';

import { createListTool } from './list-tool';
import { createInfoTool } from './info-tool';
import { createTestTool } from './test-tool';
import { createFindTool } from './find-tool';
import { createCreateTool } from './create-tool';
import { createExtractTool } from './extract-tool';
import { createAddTool } from './add-tool';
import { createRemoveTool } from './remove-tool';

export const READ_ONLY_TOOL_NAMES = [
  'list_archive',
  'archive_info',
  'test_archive',
  'find_files',
] as const;
export const MUTATING_TOOL_NAMES = [
  'create_archive',
  'extract_archive',
  'add_to_archive',
  'remove_from_archive',
] as const;

export function buildToolCatalog(
  deps: CommandDeps,
  cfg: AgentConfig,
): StructuredToolInterface[] {
  const readOnly: StructuredToolInterface[] = [
    createListTool(deps, cfg),
    createInfoTool(deps, cfg),
    createTestTool(deps, cfg),
    createFindTool(deps, cfg),
  ];
  const mutating: StructuredToolInterface[] = cfg.allowMutations
    ? [
        createCreateTool(deps, cfg),
        createExtractTool(deps, cfg),
        createAddTool(deps, cfg),
        createRemoveTool(deps, cfg),
      ]
    : [];

  let all = [...readOnly, ...mutating];

  if (cfg.toolsAllowlist) {
    const allow = new Set(cfg.toolsAllowlist);
    const known = new Set(all.map((t) => t.name));
    for (const name of cfg.toolsAllowlist) {
      if (!known.has(name)) {
        throw new UsageError(
          `agent: --tools allowlist contains unknown tool "${name}". ` +
            `Known: ${[...known].join(', ')}.`,
        );
      }
    }
    all = all.filter((t) => allow.has(t.name));
  }

  return all;
}
