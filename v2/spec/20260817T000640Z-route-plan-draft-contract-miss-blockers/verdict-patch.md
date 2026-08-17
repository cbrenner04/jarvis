## Verdict — changes required before merge

### 1. Acceptance criterion #3 is ticked on a test that does not exercise the behavior it names (blocking)

The test titled `plan-draft blocker contract_miss skips absent or non-file staged intent.md` dispatches the loop with the default prompt and spec path — no `plan.prompt.draft` promptId, no staged `.jarvis-plan-stage`. It manipulates the worktree's durable `spec.md` and asserts `failedContractId: "artifact.exists"`. So it proves the generic eligibility guard only. Three of the criterion's four clauses are unproven: that the skipped target is *staged* `intent.md`, that `plan.draft.blocker` stays logged and terminally settled in that situation, and that nothing falls back to or modifies the durable spec path (vacuous, since the manipulated path *is* the durable spec path). The title also names a file the test never touches, which misleads readers and weakens the mutation verifier's title linkage.

Required outcome: the test bearing that title must actually dispatch a `plan.prompt.draft` write and drive the staged `<expectedArtifactPath>/intent.md` target into the ineligible states, while keeping the generic-guard coverage that already works. Both plan-draft arms are reachable and should be covered:

- **symlink** — the `plan.draft.blocker` contract reads staged `intent.md` through symlink-following `existsSync`/`readFileSync` (`v2/src/execution/write.ts:391-396`), so an agent that replaces staged `intent.md` with a symlink to *baseline + appended `## Blocker`* trips `plan.draft.blocker` with an ineligible symlink target. This is the arm that proves the criterion's `plan.draft.blocker` clause.
- **absent** — deleting staged `intent.md` passes the blocker contract (`if (!existsSync(intentPath)) return true`) and fails shape, routing an `artifact.exists` miss at an absent *staged* path.

For each, assert the contract settles terminally with `contract_miss_detail` logged, the staged target is neither created nor replaced (symlink target contents unchanged), and the durable spec directory/path is neither created nor modified. Keep the `// @mutate` directive on the eligibility guard so inverting it turns this pin RED.

Rationale: the tick claims coverage the code does not have. The pre-existing generic test is worth keeping, but it cannot stand in for the plan-draft × ineligible-target behavior the criterion names — that combination is exactly what this subspec exists to make safe.

### 2. Document the new blocker-text recycling consequence (blocking, docs-only)

`appendBlockerToSpec` writes the reserved `Artifact contract check failed:` marker. Now that *every* `plan.prompt.draft` contract miss lands in staged `intent.md`, a preserved-stage follow-up write (redraft or staged-markdown-lint reprompt) will strip that harness section via `collectAndClearHarnessDiagnostics` and re-inject its payload under `## Prior harness normalizer diagnostics` — including for `plan.draft.blocker` and shape misses, whose payload is a bare contract ID rather than a normalizer message. This is a new behavioral consequence of the routing change and neither doc mentions it.

Required outcome: `v2/docs/write-behavior.md` (and the corresponding `v1-behaviors.md` entry, which already describes the clearing/forwarding mechanic) must state that harness `## Blocker` sections from any plan-draft contract miss — not just normalizer rejections — are cleared and forwarded as prior-harness diagnostics on the next preserved-stage attempt. Scope note for accuracy: stage preservation requires `index.md` in the stage, so a blocker miss with no tree wipes the stage and never recycles; this path is reachable only when the agent produced a full tree *and* appended a blocker.

Rationale: `v2/docs/documentation-standard.md` requires behavior changes to land their doc alignment in the same subspec, and this is an operator-visible prompt-content change.

### 3. Remove the overclaiming assertion in the preservation test (minor)

In `done/no-work with failing contract appends blocker and stops`, the added `expect(result.outcomeKind).toBe("contract_miss")` and its comment about eligibility are inert: the terminal mapping derives `outcomeKind` from `kind` unconditionally, so the line is implied by the existing `result.kind` assertion and proves nothing about append eligibility. The criterion is genuinely satisfied by the pre-existing assertions that the eligible file contains `## Blocker` and `artifact.exists`.

Required outcome: drop the tautological line and its comment, or replace them with an assertion that actually distinguishes eligible from skipped (e.g. that the blocker landed *and* the checkpoint settled), so the test does not advertise coverage it lacks.

### Explicitly not required

- No new log event or telemetry for a skipped append. The subspec decision preserves existing contract-miss logging and settlement and rules out converting append safety into a new invocation or settlement failure; a `log-stream` schema addition exceeds this subspec. The residual operator-diagnostics ambiguity (a `contract_miss_detail` record no longer implies the blocker landed) is follow-up material.
- No writability pre-check or best-effort settlement on append failure. The decision states append failures after eligibility propagate and that race hardening is out of scope; the current propagate-uncaught behavior and its test match that.
- No change to the `lstat`-based (symlink-ineligible) guard. Diverging from the `statSync` convention used at read-eligibility sites is deliberate for a write target, and both the Decisions section and `write-behavior.md` state the symlink treatment explicitly.
- No `getuid()` skip on the chmod-based test; chmod-unwritable-target tests are established precedent in this repo and CI runs non-root.