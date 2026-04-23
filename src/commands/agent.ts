import dotenv from 'dotenv';
import { UsageError } from '../util/errors';
import { loadAgentConfig, type AgentConfigFlags } from '../config/agent-config';
import { getProvider } from '../agent/providers/registry';
import { buildToolCatalog } from '../agent/tools/registry';
import { loadSystemPrompt } from '../agent/system-prompt';
import { createAgentLogger } from '../agent/logging';
import { runOneShot, runInteractive, type AgentResult } from '../agent/run';
import type { CommandDeps } from '../types';

export interface AgentOptions extends AgentConfigFlags {
  logFile?: string;
  quiet?: boolean;
}

export type AgentDeps = CommandDeps;

export async function run(
  deps: AgentDeps,
  prompt: string | null,
  opts: AgentOptions,
): Promise<AgentResult | void> {
  // Load .env (process env always wins). The dotenv mock in specs returns
  // an empty parsed object so test environments stay deterministic.
  dotenv.config({ override: false, ...(opts.envFile ? { path: opts.envFile } : {}) });

  const cfg = loadAgentConfig(opts);

  if (!cfg.interactive && (!prompt || !prompt.trim())) {
    throw new UsageError('agent: a prompt argument is required unless --interactive is set.');
  }

  const factory = getProvider(cfg.provider);
  const model = factory(cfg);
  const tools = buildToolCatalog(deps, cfg);
  const systemPrompt = await loadSystemPrompt(cfg);
  const logger = await createAgentLogger(cfg, {
    logFilePath: opts.logFile ?? deps.config.logFile,
    quiet: opts.quiet ?? deps.config.quiet,
  });

  try {
    if (cfg.interactive) {
      await runInteractive({
        model,
        tools,
        systemPrompt,
        cfg,
        logger,
        // Lets the REPL flip mutation tools on/off mid-session via
        // `/mutations on|off` without restarting.
        rebuildTools: (allowMutations) =>
          buildToolCatalog(deps, { ...cfg, allowMutations }),
      });
      return;
    }
    return await runOneShot({
      model,
      tools,
      systemPrompt,
      cfg,
      prompt: prompt!,
      logger,
    });
  } finally {
    await logger.close();
  }
}
