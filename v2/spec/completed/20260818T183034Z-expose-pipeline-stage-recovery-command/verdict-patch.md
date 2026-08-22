## Verdict

Four required outcomes. Everything else reviewed is either correct as shipped or out of this subspec's scope.

### 1. The recover result parser must reject malformed payloads, not just unknown kinds

`parsePipelineRecoverOutcome` checks only that `kind` is one of the three known strings, then casts. An `admitted` envelope missing `stageId`/`entryRunId`, or a `resolution_refused` missing `message`, currently passes: the first exits `0` while printing a JSON line stripped of the very handles the decision ledger says are the reason for printing it (`stageId`/`entryRunId` are how the operator reaches `jarvis run log` and the settled row); the second prints `undefined` into the stderr line. `write-behavior.md` promises `invalid daemon response` for "malformed result envelope," and both sibling parsers in this file (`parsePipelineWaitBoundary`, `parsePipelineMutationOutcome`) validate their payload fields before returning.

**Required:** each known kind's required string fields are validated before the outcome is accepted; a kind-valid but field-invalid envelope takes the `invalid daemon response` / exit-`1` path. Keep it a *validation* — the admitted stdout must remain a passthrough of the daemon's object, not a reconstruction, per the criterion that the daemon's `admitted` result is what gets printed. The existing unknown-kind guard must stay on one physical line so its `@mutate` directive still quotes unique text; add coverage for at least one field-invalid case.

### 2. Remove `operator_blocker` from the runbook's `resolution_refused` reason list

`operator_blocker` is `recoverPlanStage`'s attempt-time refusal (daemon-host step 3), which by contract lands *after* `admitted` has already returned and settles the stage row `failed` in place. The new runbook paragraph lists it among `resolution_refused` examples and then asserts those "refuse before any attempt runs" — wrong in precisely the case an operator is most likely to hit, and it implies the blocker case is visible at the command's exit when it is only visible on the stage row. Step 3 of the numbered loop already states the correct behavior; the reason list must not contradict it.

### 3. The runbook loop must name a command that actually prints the fields it tells the operator to read

Plain `jarvis pipeline list` renders six tab-separated fields (truncated pipeline ID, name, state, seed basename, age, stage glyph summary). It prints no `workflowInvocationId`, no `branchKey`, no `artifact`, and no `failureDetail`. Steps 1 and 5 of the new loop, and the corresponding sentence in `write-behavior.md`, instruct the operator to read those fields from it.

**Required:** the doc directs the operator to the JSON form (`jarvis pipeline list --json`) wherever it tells them to read `workflowInvocationId`, `status`, `artifact`, or `failureDetail`, so the documented loop is executable as written.

### 4. The help criterion's named test must prove what the criterion claims

The ticked criterion says `help pipeline recover matches recover usage` proves both the `PIPELINE_RECOVER_USAGE` rendering *and* the `recover` summary line under `jarvis help pipeline`. The named test asserts only the first; the summary-line assertion sits in a different test. The behavior is covered, but a ticked criterion should be satisfied by the test it names.

**Required:** the summary-line assertion (and the `PIPELINE_USAGE`-names-`recover` check) is provable from the test the criterion names. Do not delete the coverage from the family-help test if you prefer to keep it there — but the named test must stand on its own against the criterion.

### Optional, if cheap

The `stage_claimed` stderr line names the stage but not the branch. On a fan-out pipeline several branches share a `stageId`, so the line does not identify which branch refused; the daemon result carries `branchKey`. Including it is a strict improvement. Not required by the acceptance criteria (which ask only that the claimed stage be named), so decline it if it forces churn beyond the one assertion.

### Declined

- **Missing `RpcError`/connection-failure coverage on the extracted `requestPipelineRpc` helper** — real gap, but pre-existing across the whole pipeline family and outside this subspec's criteria. The extraction preserved behavior; it did not create the gap.
- **Relocating the `--detach`/`--spec`/preflight paragraphs now sitting under the new `### Pipeline recover` heading** — those paragraphs were already stranded under `### Pipeline resume`; the new heading neither created nor worsened the problem. A doc restructure this subspec did not scope.
- **`switch`-based exhaustiveness over the flat `if` chain and ternary** — the implementer notes require the exit-code expression to stay on one physical line for its `@mutate` directive. Current shape is correct.
- **One mutation criterion's prose** ("suppresses `invalid daemon response` and takes the admitted path") slightly misdescribes its mutant: with the kind guard neutered, an unknown envelope falls through every branch and still exits `1`, so the test goes red on the stderr assertion rather than the exit code. The checkpoint is sound and the directive mutates a real guard — no code change, and not worth a spec edit at this stage.