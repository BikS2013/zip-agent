<zip-agent-list>
    <objective>
        List the entries inside a zip archive (name, size, modified time).
    </objective>
    <command>
        zip-agent list &lt;archive&gt; [--just-count]
    </command>
    <info>
        Wraps `unzip -l`. Prints {archive, entryCount, totalUncompressedSize, entries[]}. With `--just-count` the entries array is omitted.
        Exit codes: 0 OK · 2 usage · 5 upstream (unzip non-zero) · 6 io (archive unreadable).
        Examples:
            zip-agent list release.zip
            zip-agent list release.zip --just-count
            zip-agent list /path/to/file.zip --table
    </info>
</zip-agent-list>
