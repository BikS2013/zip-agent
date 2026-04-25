<zip-agent-tui>
    <objective>
        Raw-mode terminal UI bound to `zip-agent agent -i`. Token-by-token streaming, animated spinner, multiline raw-mode editing, slash commands, and per-thread persistence under ~/.tool-agents/zip-agent/.
    </objective>
    <command>
        zip-agent agent -i [-p &lt;name&gt;] [-m &lt;id&gt;] [--allow-mutations] [other agent flags]
    </command>
    <info>
        Default interactive entry point. Replaces the legacy readline REPL when -i is used; pass --legacy-repl to revert.
        Streaming: each token from the model is written to stdout the moment it arrives. Tool calls show as breadcrumbs (↳ calling tool_name(args) ✓). An animated braille spinner runs while waiting for the first token or processing a tool result.
        Aborting: ESC or Ctrl+C during a streaming turn cancels the in-flight request via AbortController. ESC at the input prompt is a no-op (does NOT exit). Ctrl+C at the input prompt cancels the current edit. Ctrl+D on an empty input exits.
        Multiline editing: Shift+Enter inserts a newline (terminal-dependent — see Note below). Ctrl+J is the universal newline that works on every terminal. Enter submits.
        Editing keys: arrow keys move cursor and navigate input history at top/bottom edges; Home/End / Ctrl+A / Ctrl+E for line motion; Option+← / Ctrl+← for word motion; Ctrl+W / Alt+Backspace for word delete; Ctrl+U / Ctrl+K for line delete; Ctrl+L to clear screen; Backspace merges with previous line at column 0.
        UTF-8: Greek, Cyrillic, CJK, and emoji input round-trip intact via a stateful StringDecoder (no Latin-1 mojibake).
        Slash commands (case-sensitive — `/Help` is unknown):
          /help              — list every command and keybinding.
          /history           — list past threads from ~/.tool-agents/zip-agent/threads/, type the index to load.
          /memory            — open ~/.tool-agents/zip-agent/memory.md in $EDITOR; prints inline if $EDITOR unset.
          /new (alias /reset) — start a fresh thread (new thread_id, fresh checkpointer; memory.md kept).
          /quit (alias /exit) — exit the TUI.
          /last (alias /raw)  — re-print the last assistant message in full.
          /copy              — copy the last assistant response via pbcopy / wl-copy / xclip / xsel / clip.exe; falls back to writing ~/.tool-agents/zip-agent/last-response.txt with the path printed.
          /model             — interactive picker for provider + model id (current pre-filled). Uses getProvider(name) from the existing seven-provider registry. Validates required env vars; throws ConfigurationError on missing — never falls back. Persists the choice to tui-config.json.
          /tools             — checkbox UI for individual tools and the master --allow-mutations switch. Uses the rebuildTools callback. Toggling --allow-mutations resets the thread (mirrors legacy /mutations behaviour) so prior tool_calls don't reference tools that no longer exist.
          /system            — view the current system prompt; press `e` to edit in $EDITOR. Override is in-memory only; never persisted to disk.
          /clear             — clear the visible terminal; in-memory thread is kept.
        Persistence (under ~/.tool-agents/zip-agent/):
          memory.md                   long-term notes (NOT auto-injected into the LLM prompt).
          last-response.txt           rolling, single file; rewritten after every assistant turn.
          tui-config.json             last-used provider/model overrides + default mutations preference.
          threads/&lt;thread_id&gt;.json    per-thread transcript so /history can resume across sessions.
        All four files are bootstrapped on first TUI invocation with the same idempotent pattern as ~/.tool-agents/zip-agent/config; permission errors warn-but-continue. Mode is 0600.
        Override env vars:
          ZIP_AGENT_TUI_HOME           override the persistence root (used by tests; default is the same as the global config dir).
          ZIP_AGENT_TUI_NO_PERSIST=1   skip every TUI-side write (useful for piped invocations and CI).
          EDITOR / VISUAL              opened by /memory and /system. Without these set, /memory prints inline and /system can only display.
        Note on Shift+Enter: most terminals send plain CR for both Enter and Shift+Enter. The TUI accepts every known distinct Shift+Enter encoding (\x1b[13;2u, \x1bOM, \x1b\r, \x1b\n, \x1b[27;2;13~) but if your terminal does not send any of them you'll see /quit-style submit instead of a newline. Use Ctrl+J as the reliable universal fallback.
        Requires a TTY: piped stdin causes a clear "interactive TUI requires a TTY" error and exit. Pipe through `script -q /tmp/log` if you need a PTY in non-interactive contexts.
        Examples:
            zip-agent agent -i                                     # launch the TUI
            zip-agent agent -i --allow-mutations                   # start with mutations on
            zip-agent agent -i -p azure-openai -m gpt-4o           # pre-pick provider/model
            ZIP_AGENT_TUI_NO_PERSIST=1 zip-agent agent -i          # skip TUI persistence files
            zip-agent agent -i --legacy-repl                       # fall back to the old REPL
    </info>
</zip-agent-tui>
