<zip-agent-create>
    <objective>
        Create a new zip archive from one or more inputs (`zip -r`).
    </objective>
    <command>
        zip-agent create &lt;archive&gt; [inputs...] [-r] [-x &lt;pattern...&gt;] [--password &lt;p&gt;] [--force | --idempotent]
    </command>
    <info>
        `-r/--recurse` (default true) recurses directories. `-x` excludes glob patterns. `--password` enables ZIP encryption (visible in process listings).
        Refuses to overwrite an existing archive unless `--force` or `--idempotent` is set; otherwise raises CollisionError (exit 7).
        Examples:
            zip-agent create out.zip ./src ./README.md
            zip-agent create out.zip ./reports -x "*.DS_Store" "*.tmp" --idempotent
            zip-agent create secrets.zip ./vault --password 'hunter2'
    </info>
</zip-agent-create>
