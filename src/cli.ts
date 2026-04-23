#!/usr/bin/env node
import { Command } from 'commander';
import { makeAction } from './cli/make-action';
import { emitResult } from './cli/emit-result';
import * as listCmd from './commands/list';
import * as infoCmd from './commands/info';
import * as testCmd from './commands/test';
import * as findCmd from './commands/find';
import * as createCmd from './commands/create';
import * as extractCmd from './commands/extract';
import * as addCmd from './commands/add';
import * as removeCmd from './commands/remove';
import * as agentCmd from './commands/agent';
import type { AgentOptions } from './commands/agent';

const program = new Command();

program
  .name('zip-agent')
  .description('TypeScript CLI wrapping OS zip/unzip + LangGraph agent.')
  .version('0.1.0')
  .option('--json', 'Emit JSON output (default)')
  .option('--table', 'Emit table output')
  .option('--quiet', 'Suppress stderr')
  .option('--verbose', 'Verbose stderr trace')
  .option('--log-file <path>', 'Append redacted logs to file');

// list ---------------------------------------------------------------
program
  .command('list <archive>')
  .description('List archive contents (unzip -l).')
  .option('--just-count', 'Return only entry count', false)
  .action(
    makeAction<{ justCount?: boolean }, [string]>(program, async (deps, g, opts, archive) => {
      const result = await listCmd.run(deps, { archive }, { justCount: opts.justCount });
      emitResult(result, g.outputMode);
    }),
  );

// info ---------------------------------------------------------------
program
  .command('info <archive>')
  .description('Detailed archive info (zipinfo -v).')
  .option('--no-verbose-info', 'Use the short zipinfo table')
  .action(
    makeAction<{ verboseInfo?: boolean }, [string]>(program, async (deps, g, opts, archive) => {
      const result = await infoCmd.run(deps, { archive }, { verboseInfo: opts.verboseInfo });
      emitResult(result, g.outputMode);
    }),
  );

// test ---------------------------------------------------------------
program
  .command('test <archive>')
  .description('Verify archive integrity (unzip -t).')
  .action(
    makeAction<Record<string, never>, [string]>(program, async (deps, g, _opts, archive) => {
      const result = await testCmd.run(deps, { archive });
      emitResult(result, g.outputMode);
    }),
  );

// find ---------------------------------------------------------------
program
  .command('find <path>')
  .description('Find files/dirs/sockets/pipes under a path. Read-only filesystem search.')
  .option(
    '-t, --type <type...>',
    'Restrict to one or more types: file, dir, symlink, socket, pipe, block, char',
  )
  .option('-n, --name <glob>', 'Glob applied to entry basename, e.g. "*.sock"')
  .option('--max-depth <n>', 'Max recursion depth (default 20)', (v) => parseInt(v, 10))
  .option('--max-results <n>', 'Stop after N matches (default 500)', (v) => parseInt(v, 10))
  .option('--include-hidden', 'Recurse into dot-prefixed directories', false)
  .option('--exclude-dirs <name...>', 'Directory basenames to skip entirely')
  .action(
    makeAction<
      {
        type?: findCmd.FindType[];
        name?: string;
        maxDepth?: number;
        maxResults?: number;
        includeHidden?: boolean;
        excludeDirs?: string[];
      },
      [string]
    >(program, async (deps, g, opts, p) => {
      const result = await findCmd.run(
        deps,
        { path: p },
        {
          types: opts.type,
          name: opts.name,
          maxDepth: opts.maxDepth,
          maxResults: opts.maxResults,
          includeHidden: opts.includeHidden,
          excludeDirs: opts.excludeDirs ?? [],
        },
      );
      emitResult(result, g.outputMode);
    }),
  );

// create -------------------------------------------------------------
program
  .command('create <archive> [inputs...]')
  .description('Create a new archive (zip -r).')
  .option('-r, --recurse', 'Recurse directories', true)
  .option('--no-recurse', 'Do not recurse')
  .option('-x, --exclude <pattern...>', 'Exclude patterns')
  .option('--password <p>', 'Encrypt with password')
  .option('--force', 'Overwrite existing archive', false)
  .option('--idempotent', 'Re-create existing archive idempotently', false)
  .action(
    makeAction<
      {
        recurse?: boolean;
        exclude?: string[];
        password?: string;
        force?: boolean;
        idempotent?: boolean;
      },
      [string, string[]]
    >(program, async (deps, g, opts, archive, inputs) => {
      const result = await createCmd.run(
        deps,
        { archive, inputs: inputs ?? [] },
        {
          recurse: opts.recurse,
          exclude: opts.exclude ?? [],
          password: opts.password,
          force: opts.force,
          idempotent: opts.idempotent,
        },
      );
      emitResult(result, g.outputMode);
    }),
  );

// extract ------------------------------------------------------------
program
  .command('extract <archive>')
  .description('Extract an archive (unzip).')
  .option('-d, --dest <dir>', 'Destination directory', '.')
  .option('--password <p>', 'Decrypt with password')
  .option('--include <pattern...>', 'Only extract entries matching pattern(s)')
  .option('--force', 'Overwrite existing files', false)
  .option('--no-clobber', 'Refuse to overwrite (-n)')
  .action(
    makeAction<
      {
        dest?: string;
        password?: string;
        include?: string[];
        force?: boolean;
        noClobber?: boolean;
      },
      [string]
    >(program, async (deps, g, opts, archive) => {
      const result = await extractCmd.run(deps, { archive }, {
        dest: opts.dest,
        password: opts.password,
        include: opts.include ?? [],
        force: opts.force,
        noClobber: opts.noClobber,
      });
      emitResult(result, g.outputMode);
    }),
  );

// add ----------------------------------------------------------------
program
  .command('add <archive> [files...]')
  .description('Add or update entries in an archive (zip -u).')
  .option('-r, --recurse', 'Recurse directories', false)
  .option('--password <p>', 'Encrypt with password')
  .action(
    makeAction<{ recurse?: boolean; password?: string }, [string, string[]]>(
      program,
      async (deps, g, opts, archive, files) => {
        const result = await addCmd.run(
          deps,
          { archive, files: files ?? [] },
          { recurse: opts.recurse, password: opts.password },
        );
        emitResult(result, g.outputMode);
      },
    ),
  );

// remove -------------------------------------------------------------
program
  .command('remove <archive> [patterns...]')
  .description('Delete entries from an archive (zip -d).')
  .action(
    makeAction<Record<string, never>, [string, string[]]>(
      program,
      async (deps, g, _opts, archive, patterns) => {
        const result = await removeCmd.run(deps, { archive, patterns: patterns ?? [] });
        emitResult(result, g.outputMode);
      },
    ),
  );

// agent --------------------------------------------------------------
program
  .command('agent [prompt]')
  .description('Run the LangGraph ReAct agent over zip-agent.')
  .option('-i, --interactive', 'Start a REPL', false)
  .option('-p, --provider <name>', 'LLM provider')
  .option('-m, --model <id>', 'Model id / deployment name')
  .option('--max-steps <n>', 'ReAct iteration cap', (v) => parseInt(v, 10))
  .option('--temperature <t>', 'Sampling temperature', (v) => parseFloat(v))
  .option('--system <text>', 'Inline system prompt')
  .option('--system-file <path>', 'System prompt file')
  .option('--tools <csv>', 'Tool allowlist')
  .option('--per-tool-budget <bytes>', 'Per-tool byte budget', (v) => parseInt(v, 10))
  .option('--allow-mutations', 'Enable mutation tools', false)
  .option('--env-file <path>', 'Override default .env lookup')
  .option('--verbose', 'Stream per-step trace to stderr', false)
  .action(
    makeAction<
      {
        interactive?: boolean;
        provider?: string;
        model?: string;
        maxSteps?: number;
        temperature?: number;
        system?: string;
        systemFile?: string;
        tools?: string;
        perToolBudget?: number;
        allowMutations?: boolean;
        envFile?: string;
        verbose?: boolean;
      },
      [string | undefined]
    >(program, async (deps, g, opts, prompt) => {
      const agentOpts: AgentOptions = {
        interactive: opts.interactive ?? false,
        provider: opts.provider,
        model: opts.model,
        maxSteps: opts.maxSteps,
        temperature: opts.temperature,
        systemPrompt: opts.system,
        systemPromptFile: opts.systemFile,
        tools: opts.tools,
        perToolBudgetBytes: opts.perToolBudget,
        allowMutations: opts.allowMutations ?? false,
        envFile: opts.envFile,
        verbose: opts.verbose ?? false,
        quiet: g.quiet,
      };
      const result = await agentCmd.run(deps, prompt ?? null, agentOpts);
      if (result) emitResult(result, g.outputMode);
    }),
  );

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`[zip-agent] fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
