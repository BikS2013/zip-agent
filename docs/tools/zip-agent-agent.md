<zip-agent-agent>
    <objective>
        Run a LangGraph ReAct agent that wraps the seven zip operations as LLM-callable tools, supporting seven providers.
    </objective>
    <command>
        zip-agent agent [prompt] [-i] [--legacy-repl] [-p &lt;name&gt;] [-m &lt;id&gt;] [--max-steps &lt;n&gt;] [--temperature &lt;t&gt;] [--system &lt;text&gt; | --system-file &lt;path&gt;] [--tools &lt;csv&gt;] [--per-tool-budget &lt;bytes&gt;] [--allow-mutations] [--env-file &lt;path&gt;] [--verbose]
    </command>
    <info>
        Two modes: one-shot (positional prompt, JSON envelope on stdout) or interactive (`-i`).
        Interactive mode launches the raw-mode TUI by default (see &lt;zip-agent-tui&gt;). Use `--legacy-repl` for the older plain-readline REPL — kept for one release cycle as an escape hatch.
        Providers (set via -p or ZIP_AGENT_PROVIDER): openai, anthropic, google, azure-openai, azure-anthropic, azure-deepseek, local-openai.
        The local-openai provider targets any OpenAI-wire-compatible local server (OLLaMA, LM Studio, MLX-LM, vLLM, etc.).
          Required: ZIP_AGENT_LOCAL_OPENAI_BASE_URL (e.g. http://localhost:11434/v1). Optional: ZIP_AGENT_LOCAL_OPENAI_API_KEY (defaults to "local").
        Mutating tools (create/extract/add/remove) are excluded from the catalog unless `--allow-mutations`.
        Per-tool result is truncated to `--per-tool-budget` (default 16384 bytes) before reaching the model; truncation produces a valid JSON `{"__truncated": true, ...}` wrapper.
        Configuration precedence (highest to lowest):
          --env-file &lt;path&gt;  > CLI flag > ./.env > ~/.tool-agents/zip-agent/config > process.env > defaults
          Note: file sources (.env and global config) WIN OVER process.env.
          --env-file replaces both file sources; chain becomes: --env-file > process.env.
        Required values have NO fallback (exit 3 ConfigurationError on missing). Exception: ZIP_AGENT_LOCAL_OPENAI_API_KEY defaults to "local" (ADR-007).
        Exit codes mirror the rest of the CLI: 2 usage · 3 config · 4 auth · 5 upstream · 6 io · 7 collision · 130 SIGINT.
        Global config file: ~/.tool-agents/zip-agent/config — auto-bootstrapped on first `agent` invocation. The directory tree is created if missing and seeded with a fully-commented copy of .env.example (all keys inert by default, so the bootstrap never changes runtime behavior). On creation a one-line note is written to stderr; subsequent runs are silent. Suppress the note with the global --quiet flag. Existing files are NEVER overwritten — your edits are safe across upgrades. Format: plain dotenv KEY=VALUE.
        Examples:
            zip-agent agent "what's the largest entry in release.zip?"
            zip-agent agent -p azure-openai -m gpt-4o "is downloaded.zip corrupted?"
            zip-agent agent -p local-openai -m llama3 "list the entries in release.zip"
            zip-agent agent -i --allow-mutations
            zip-agent agent -i --legacy-repl                # fall back to readline REPL
            zip-agent agent --tools list_archive,test_archive "give me a one-paragraph summary of release.zip"
            zip-agent agent --env-file ./.env.prod "list everything bigger than 1 MB in release.zip"
    </info>
</zip-agent-agent>
