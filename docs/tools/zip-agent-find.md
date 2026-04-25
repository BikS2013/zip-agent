<zip-agent-find>
    <objective>
        Search a directory tree for files / dirs / sockets / pipes / etc. Read-only. Used by the agent to locate special files that block `zip` (sockets, FIFOs) and feed them to `--exclude`.
    </objective>
    <command>
        zip-agent find &lt;path&gt; [-t &lt;type...&gt;] [-n &lt;glob&gt;] [--max-depth &lt;n&gt;] [--max-results &lt;n&gt;] [--include-hidden] [--exclude-dirs &lt;name...&gt;]
    </command>
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
