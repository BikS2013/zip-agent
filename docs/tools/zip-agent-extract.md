<zip-agent-extract>
    <objective>
        Extract a zip archive into a destination directory (`unzip`).
    </objective>
    <command>
        zip-agent extract &lt;archive&gt; [-d &lt;dir&gt;] [--include &lt;pattern...&gt;] [--password &lt;p&gt;] [--force | --no-clobber]
    </command>
    <info>
        `-d` selects the destination (default cwd). `--include` restricts which entries to extract.
        Returns {archive, dest, filesExtracted}. Refuses to overwrite by default; raises CollisionError when `unzip` would prompt.
        Examples:
            zip-agent extract release.zip -d ./out
            zip-agent extract release.zip -d ./out --include "docs/*"
            zip-agent extract secrets.zip --password 'hunter2'
    </info>
</zip-agent-extract>
