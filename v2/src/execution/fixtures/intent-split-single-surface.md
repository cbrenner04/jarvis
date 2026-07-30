# Settle exhausted write attempts in the execution loop

Within `v2/src/execution/`, record the final attempt reason, classify exhausted retries as failed,
and return the terminal write result to the workflow runner. These related concerns share the
execution-loop boundary and require no persistence, daemon, or CLI change.
