- Define timeout as a terminal fence: it must complete the loop despite non-settling execution, close the started/resumed attempt as failed, emit exactly one `loop_finished: iteration_timeout`, and suppress late completion or failure effects. Specify abort/timeout race precedence.

- Cover the full terminal surface: add `iteration_timeout` to durable outcome/state/log contracts and all workflow, daemon `list`/`wait`, snapshot, CLI, and operator-error mappings that expose loop outcomes. Distinguish it from `run_execution_failed`; document daemon vocabulary in `v2/docs/daemon-host.md` if exposed there.

- Name the resolved configuration source and require propagation through direct launches, workflow launches, and persisted workflow revision/resume reconstruction, with the existing 600,000 ms default.

- Expand verification beyond one pre-spawn stall: prove normal settlement clears the watchdog, each iteration gets a fresh budget, abort-before-timeout precedence, timeout/settlement races, late-result suppression, and daemon workflow-start liveness/ownership cleanup. Short injected budgets remain required.

- Keep this as one subspec: timeout terminalization and its observable consumer propagation are inseparable.
