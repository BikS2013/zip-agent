<structure-and-conventions>
## Structure & Conventions

- Every time you want to create a test script, you must create it in the test_scripts folder. If the folder doesn't exist, you must make it.

- All the plans must be kept under the docs/design folder inside the project's folder in separate files: Each plan file must be named according to the following pattern: plan-xxx-<indicative description>.md

- The complete project design must be maintained inside a file named docs/design/project-design.md under the project's folder. The file must be updated with each new design or design change.

- All the reference material used for the project must be collected and kept under the docs/reference folder.
- All the functional requirements and all the feature descriptions must be registered in the /docs/design/project-functions.MD document under the project's folder.

<configuration-guide>
- If the user ask you to create a configuration guide, you must create it under the docs/design folder, name it configuration-guide.md and be sure to explain the following:
  - if multiple configuration options exist (like config file, env variables, cli params, etc) you must explain the options and what is the priority of each one.
  - Which is the purpose and the use of each configuration variable
  - How the user can obtain such a configuration variable
  - What is the recomented approach of storing or managing this configuration variable
  - Which options exist for the variable and what each option means for the project
  - If there are any default value for the parameter you must present it.
  - For configuration parameters that expire (e.g., PAT keys, tokens), I want you to propose to the user adding a parameter to capture the parameter's expiration date, so the app or service can proactively warn users to renew.
</configuration-guide>

- Every time you create a prompt working in a project, the prompt must be placed inside a dedicated folder named prompts. If the folder doesn't exists you must create it. The prompt file name must have an sequential number prefix and must be representative to the prompt use and purpose.

- You must maintain a document at the root level of the project, named "Issues - Pending Items.md," where you must register any issue, pending item, inconsistency, or discrepancy you detect. Every time you fix a defect or an issue, you must check this file to see if there is an item to remove.
- The "Issues - Pending Items.md" content must be organized with the pending items on top and the completed items after. From the pending items the most critical and important must be first followed by the rest.

- When I ask you to create tools in the context of a project everything must be in Typescript.
- Every tool you develop must be documented in the project's Claude.md file
- The documentation must be in the following format:
<toolName>
    <objective>
        what the tool does
    </objective>
    <command>
        the exact command to run
    </command>
    <info>
        detailed description of the tool
        command line parameters and their description
        examples of usage
    </info>
</toolName>

- Every time I ask you to do something that requires the creation of a code script, I want you to examine the tools already implemented in the scope of the project to detect if the code you plan to write, fits to the scope of the tool.
- If so, I want you to implement the code as an extension of the tool, otherwise I want you to build a generic and abstract version of the code as a tool, which will be part of the toolset of the project.
- Our goal is, while the project progressing, to develop the tools needed to test, evaluate, generate data, collect information, etc and reuse them in a consistent manner.
- All these tools must be documented inside the CLAUDE.md to allow their consistent reuse.

- When I ask you to locate code, I need to give me the folder, the file name, the class, and the line number together with the code extract.
- Don't perform any version control operation unless I explicitly request it.

- When you design databases you must align with the following table naming conventions:
  - Table names must be singular e.g. the table that keeps customers' data must be called "Customer"
  - Tables that are used to express references from one entity to another can by plural if the first entity is linked to many other entities.
  - So we have "Customer" and "Transaction" tables, we have CustomerTransactions.

- You must never create fallback solutions for configuration settings. In every case a configuration setting is not provided you must raise the appropriate exception. You must never substitute the missing config value with a default or a fallback value.
- If I ask you to make an exception to the configuration setting rule, you must write this exception in the projects memory file, before you implement it.
</structure-and-conventions>

## Tools

<zip-agent-list>
    <objective>List the entries inside a zip archive (name, size, modified time).</objective>
    <command>zip-agent list &lt;archive&gt; [--just-count]</command>
    <info>
        Wraps `unzip -l`. Prints {archive, entryCount, totalUncompressedSize, entries[]}. With `--just-count` the entries array is omitted.
        Exit codes: 0 OK · 2 usage · 5 upstream (unzip non-zero) · 6 io (archive unreadable).
        Examples:
            zip-agent list release.zip
            zip-agent list release.zip --just-count
            zip-agent list /path/to/file.zip --table
    </info>
</zip-agent-list>

<zip-agent-info>
    <objective>Detailed metadata about a zip archive (`zipinfo -v`).</objective>
    <command>zip-agent info &lt;archive&gt; [--no-verbose-info]</command>
    <info>
        Returns {archive, raw, header, entryCount}. `--no-verbose-info` uses the short zipinfo table instead of -v.
        Heavier than `list`; use only when entry-level detail (CRC, compression method, attributes) is needed.
        Examples:
            zip-agent info release.zip
            zip-agent info release.zip --no-verbose-info
    </info>
</zip-agent-info>

<zip-agent-test>
    <objective>Verify the integrity of a zip archive (`unzip -t`).</objective>
    <command>zip-agent test &lt;archive&gt;</command>
    <info>
        Returns {archive, ok, errors[], raw}. ok=true requires zero detected errors AND a clean exit code from `unzip -t`.
        Examples:
            zip-agent test downloaded.zip
    </info>
</zip-agent-test>

<zip-agent-find>
    <objective>Search a directory tree for files / dirs / sockets / pipes / etc. Read-only. Used by the agent to locate special files that block `zip` (sockets, FIFOs) and feed them to `--exclude`.</objective>
    <command>zip-agent find &lt;path&gt; [-t &lt;type...&gt;] [-n &lt;glob&gt;] [--max-depth &lt;n&gt;] [--max-results &lt;n&gt;] [--include-hidden] [--exclude-dirs &lt;name...&gt;]</command>
    <info>
        Node-native (no shell-out to BSD/GNU find). Returns {searchPath, matchCount, truncated, matches:[{path,type}]}.
        Type values: file, dir, symlink, socket, pipe, block, char, unknown.
        Defaults: maxDepth=20, maxResults=500, hidden dot-directories skipped, all types matched.
        `--name` is a tiny glob (only `*` and `?` wildcards). For more, run multiple finds and combine.
        Examples:
            zip-agent find ~/ai-coding --type socket pipe
            zip-agent find ./reports --type file --name "*.log" --max-results 50
            zip-agent find / --type socket --max-depth 4 --exclude-dirs node_modules .git
    </info>
</zip-agent-find>

<zip-agent-create>
    <objective>Create a new zip archive from one or more inputs (`zip -r`).</objective>
    <command>zip-agent create &lt;archive&gt; [inputs...] [-r] [-x &lt;pattern...&gt;] [--password &lt;p&gt;] [--force | --idempotent]</command>
    <info>
        `-r/--recurse` (default true) recurses directories. `-x` excludes glob patterns. `--password` enables ZIP encryption (visible in process listings).
        Refuses to overwrite an existing archive unless `--force` or `--idempotent` is set; otherwise raises CollisionError (exit 7).
        Examples:
            zip-agent create out.zip ./src ./README.md
            zip-agent create out.zip ./reports -x "*.DS_Store" "*.tmp" --idempotent
            zip-agent create secrets.zip ./vault --password 'hunter2'
    </info>
</zip-agent-create>

<zip-agent-extract>
    <objective>Extract a zip archive into a destination directory (`unzip`).</objective>
    <command>zip-agent extract &lt;archive&gt; [-d &lt;dir&gt;] [--include &lt;pattern...&gt;] [--password &lt;p&gt;] [--force | --no-clobber]</command>
    <info>
        `-d` selects the destination (default cwd). `--include` restricts which entries to extract.
        Returns {archive, dest, filesExtracted}. Refuses to overwrite by default; raises CollisionError when `unzip` would prompt.
        Examples:
            zip-agent extract release.zip -d ./out
            zip-agent extract release.zip -d ./out --include "docs/*"
            zip-agent extract secrets.zip --password 'hunter2'
    </info>
</zip-agent-extract>

<zip-agent-add>
    <objective>Add or update entries in an existing archive (`zip -u`).</objective>
    <command>zip-agent add &lt;archive&gt; [files...] [-r] [--password &lt;p&gt;]</command>
    <info>
        Returns {archive, added, updated}. `zip -u` only writes entries newer than what's already in the archive (use `add` for true updates; use `create` to rebuild).
        Examples:
            zip-agent add release.zip CHANGELOG.md
            zip-agent add release.zip ./extras -r
    </info>
</zip-agent-add>

<zip-agent-remove>
    <objective>Delete entries from a zip archive (`zip -d`).</objective>
    <command>zip-agent remove &lt;archive&gt; [patterns...]</command>
    <info>
        Returns {archive, removed}. Patterns are passed verbatim to `zip -d`; quoting at the shell level is your responsibility.
        Examples:
            zip-agent remove release.zip "secrets/*"
            zip-agent remove release.zip "*.tmp" "node_modules/*"
    </info>
</zip-agent-remove>

<zip-agent-agent>
    <objective>Run a LangGraph ReAct agent that wraps the seven zip operations as LLM-callable tools, supporting six providers.</objective>
    <command>zip-agent agent [prompt] [-i] [-p &lt;name&gt;] [-m &lt;id&gt;] [--max-steps &lt;n&gt;] [--temperature &lt;t&gt;] [--system &lt;text&gt; | --system-file &lt;path&gt;] [--tools &lt;csv&gt;] [--per-tool-budget &lt;bytes&gt;] [--allow-mutations] [--env-file &lt;path&gt;] [--verbose]</command>
    <info>
        Two modes: one-shot (positional prompt, JSON envelope on stdout) or interactive REPL (`-i`).
        Providers (set via -p or ZIP_AGENT_PROVIDER): openai, anthropic, google, azure-openai, azure-anthropic, azure-deepseek.
        Mutating tools (create/extract/add/remove) are excluded from the catalog unless `--allow-mutations`.
        Per-tool result is truncated to `--per-tool-budget` (default 16384 bytes) before reaching the model; truncation produces a valid JSON `{"__truncated": true, ...}` wrapper.
        Configuration precedence: CLI flag > process env > .env > default. Required values have NO fallback (exit 3 ConfigurationError on missing).
        Exit codes mirror the rest of the CLI: 2 usage · 3 config · 4 auth · 5 upstream · 6 io · 7 collision · 130 SIGINT.
        Examples:
            zip-agent agent "what's the largest entry in release.zip?"
            zip-agent agent -p anthropic -m claude-3-5-sonnet "is downloaded.zip corrupted?"
            zip-agent agent -i --allow-mutations
            zip-agent agent --tools list_archive,test_archive "give me a one-paragraph summary of release.zip"
            zip-agent agent --env-file ./.env.prod "list everything bigger than 1 MB in release.zip"
    </info>
</zip-agent-agent>

