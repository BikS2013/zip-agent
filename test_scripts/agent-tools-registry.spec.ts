import { describe, it, expect } from 'vitest';
import { buildToolCatalog } from '../src/agent/tools/registry';
import { UsageError } from '../src/util/errors';
import type { AgentConfig } from '../src/config/agent-config';
import type { CommandDeps } from '../src/types';
import type { ZipRunner } from '../src/util/zip-runner';

const fakeRunner: ZipRunner = {
  async run() {
    throw new Error('not used in catalog tests');
  },
};

const deps: CommandDeps = {
  config: {
    zipBin: 'zip',
    unzipBin: 'unzip',
    zipinfoBin: 'zipinfo',
    logFile: null,
    outputMode: 'json',
    quiet: false,
    verbose: false,
    cwd: '/tmp',
  },
  zipRunner: fakeRunner,
  now: () => new Date('2026-04-23T00:00:00Z'),
  logger: { info() {}, warn() {}, error() {} },
};

function makeCfg(opts: Partial<AgentConfig> = {}): AgentConfig {
  return Object.freeze({
    provider: 'openai',
    model: 'gpt',
    temperature: 0,
    maxSteps: 10,
    perToolBudgetBytes: 16384,
    systemPrompt: null,
    systemPromptFile: null,
    toolsAllowlist: null,
    allowMutations: false,
    envFilePath: null,
    verbose: false,
    interactive: false,
    providerEnv: Object.freeze({}),
    ...opts,
  }) as AgentConfig;
}

describe('buildToolCatalog', () => {
  it('returns 4 read-only tools when --allow-mutations is off', () => {
    const tools = buildToolCatalog(deps, makeCfg());
    expect(tools.map((t) => t.name).sort()).toEqual([
      'archive_info',
      'find_files',
      'list_archive',
      'test_archive',
    ]);
  });

  it('returns 8 tools when --allow-mutations is on', () => {
    const tools = buildToolCatalog(deps, makeCfg({ allowMutations: true }));
    expect(tools).toHaveLength(8);
    expect(tools.map((t) => t.name)).toContain('create_archive');
    expect(tools.map((t) => t.name)).toContain('extract_archive');
    expect(tools.map((t) => t.name)).toContain('add_to_archive');
    expect(tools.map((t) => t.name)).toContain('remove_from_archive');
    expect(tools.map((t) => t.name)).toContain('find_files');
  });

  it('applies the allowlist after mutation gating', () => {
    const tools = buildToolCatalog(
      deps,
      makeCfg({ allowMutations: true, toolsAllowlist: ['list_archive', 'create_archive'] }),
    );
    expect(tools.map((t) => t.name).sort()).toEqual(['create_archive', 'list_archive']);
  });

  it('rejects allowlists referencing unknown tools', () => {
    expect(() =>
      buildToolCatalog(deps, makeCfg({ toolsAllowlist: ['list_archive', 'no_such_tool'] })),
    ).toThrow(UsageError);
  });

  it('mutating tool descriptions are tagged with [MUTATING]', () => {
    const tools = buildToolCatalog(deps, makeCfg({ allowMutations: true }));
    for (const t of tools.filter((x) =>
      ['create_archive', 'extract_archive', 'add_to_archive', 'remove_from_archive'].includes(
        x.name,
      ),
    )) {
      expect(t.description).toContain('[MUTATING]');
    }
  });
});
