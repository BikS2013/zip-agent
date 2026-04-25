<zip-agent-info>
    <objective>
        Detailed metadata about a zip archive (`zipinfo -v`).
    </objective>
    <command>
        zip-agent info &lt;archive&gt; [--no-verbose-info]
    </command>
    <info>
        Returns {archive, raw, header, entryCount}. `--no-verbose-info` uses the short zipinfo table instead of -v.
        Heavier than `list`; use only when entry-level detail (CRC, compression method, attributes) is needed.
        Examples:
            zip-agent info release.zip
            zip-agent info release.zip --no-verbose-info
    </info>
</zip-agent-info>
