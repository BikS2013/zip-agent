import { UsageError } from '../util/errors';
import { loadAgentConfig, type AgentConfigFlags } from '../config/agent-config';
import { buildEffectiveEnv, ensureGlobalConfigFile } from '../util/env-loader';
import { getProvider } from '../agent/providers/registry';
import { buildToolCatalog } from '../agent/tools/registry';
import { loadSystemPrompt } from '../agent/system-prompt';
import { createAgentLogger } from '../agent/logging';
import { runOneShot, runInteractive, type AgentResult } from '../agent/run';
import { runInteractiveTui } from '../agent/tui';
import type { CommandDeps } from '../types';

export interface AgentOptions extends AgentConfigFlags {
  logFile?: string;
  quiet?: boolean;
  /**
   * When true, fall back to the legacy plain-readline REPL in src/agent/run.ts
   * instead of the raw-mode TUI. Kept as an escape hatch for one release
   * cycle in case the TUI breaks for a user (see plan-004-tui.md).
   */
  legacyRepl?: boolean;
}

export type AgentDeps = CommandDeps;

export async function run(
  deps: AgentDeps,
  prompt: string | null,
  opts: AgentOptions,
): Promise<AgentResult | void> {
  // Bootstrap ~/.tool-agents/zip-agent/config on first run so users have a
  // concrete file to edit instead of guessing the layout. Idempotent: on
  // subsequent runs it's a stat call. Permission errors warn but never fail.
  const quiet = opts.quiet ?? deps.config.quiet;
  const bootstrap = ensureGlobalConfigFile();
  if (!quiet) {
    if (bootstrap.created) {
      process.stderr.write(
        `[zip-agent] created global config template at ${bootstrap.path} ` +
          `(all keys commented; edit to enable)\n`,
      );
    } else if (bootstrap.warning) {
      process.stderr.write(`[zip-agent] warning: ${bootstrap.warning}\n`);
    }
  }

  // Build the effective env map using the layered precedence chain:
  //   --env-file > ./.env > ~/.tool-agents/zip-agent/config > process.env
  // When --env-file is provided it replaces both file sources.
  const effectiveEnv = buildEffectiveEnv({ envFile: opts.envFile, cwd: deps.config.cwd });

  const cfg = loadAgentConfig(opts, effectiveEnv);

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
      // Default to the raw-mode TUI; --legacy-repl falls back to the
      // original plain-readline REPL in src/agent/run.ts.
      const rebuildTools = (allowMutations: boolean) =>
        buildToolCatalog(deps, { ...cfg, allowMutations });
      if (opts.legacyRepl) {
        await runInteractive({
          model,
          tools,
          systemPrompt,
          cfg,
          logger,
          rebuildTools,
        });
      } else {
        await runInteractiveTui({
          model,
          tools,
          systemPrompt,
          cfg,
          logger,
          rebuildTools,
        });
      }
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
