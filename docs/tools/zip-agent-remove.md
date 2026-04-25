<zip-agent-remove>
    <objective>
        Delete entries from a zip archive (`zip -d`).
    </objective>
    <command>
        zip-agent remove &lt;archive&gt; [patterns...]
    </command>
    <info>
        Returns {archive, removed}. Patterns are passed verbatim to `zip -d`; quoting at the shell level is your responsibility.
        Examples:
            zip-agent remove release.zip "secrets/*"
            zip-agent remove release.zip "*.tmp" "node_modules/*"
    </info>
</zip-agent-remove>
