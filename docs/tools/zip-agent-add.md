<zip-agent-add>
    <objective>
        Add or update entries in an existing archive (`zip -u`).
    </objective>
    <command>
        zip-agent add &lt;archive&gt; [files...] [-r] [--password &lt;p&gt;]
    </command>
    <info>
        Returns {archive, added, updated}. `zip -u` only writes entries newer than what's already in the archive (use `add` for true updates; use `create` to rebuild).
        Examples:
            zip-agent add release.zip CHANGELOG.md
            zip-agent add release.zip ./extras -r
    </info>
</zip-agent-add>
