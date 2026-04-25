<zip-agent-test>
    <objective>
        Verify the integrity of a zip archive (`unzip -t`).
    </objective>
    <command>
        zip-agent test &lt;archive&gt;
    </command>
    <info>
        Returns {archive, ok, errors[], raw}. ok=true requires zero detected errors AND a clean exit code from `unzip -t`.
        Examples:
            zip-agent test downloaded.zip
    </info>
</zip-agent-test>
