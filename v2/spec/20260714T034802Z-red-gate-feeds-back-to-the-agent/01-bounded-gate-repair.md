# 01 - Write loop repairs a red gate, capped at 3 attempts

When the completion boundary's ready gate goes red, the write loop returns `ready_finalize_failed`
and stops. The worktree is still open and the failure is usually mechanical, so hand the gate output
back to the agent and re-run the gate.

## Decisions

- Only a `ReadyGateError` (from `00`) triggers repair; a flip failure returns `ready_finalize_failed` immediately as today. Rules out reprompting an agent about GitHub state it cannot change.
- A repair attempt is a full write iteration through `executeWrite` with prompt id `write.ready-repair` (new artifact `prompts/write/ready-repair.md`, registered in `prompts/registry.txt`), placeholders `GATE_COMMAND`, `GATE_EXIT_CODE`, `GATE_OUTPUT` alongside the existing spec/step-rules placeholders. The prompt hands over the raw gate output and asks for a fix; it names no specific failure classes. Rules out a harness-side classifier deciding what is repairable.
- `GATE_OUTPUT` is the last 16 KiB of the gate's combined output. Rules out feeding a multi-megabyte test log into the prompt; the tail is where the failure is.
- After each repair iteration the loop re-runs the completion committer, then `publishCompletionArtifacts` (publication is idempotent, then gate, then flip). Rules out re-running the gate over uncommitted repair edits that would never reach the PR branch.
- Repair attempts are capped at 3 (fixed constant in `write-loop.ts`, not config). A still-red gate after the third attempt returns `ready_finalize_failed` with the last gate error, PR stays draft — exactly as today.
- Repair iterations consume the iteration budget and are recorded like any other iteration (`iteration_started`, `boundary_committed`, invocation telemetry). Exhausting `maxIterations` mid-repair returns `ready_finalize_failed`, not `budget-exhausted` — the work is complete over a red gate, and `ready_finalize_failed` is the resumable outcome that says so. Rules out hidden off-budget work and rules out a misleading budget outcome.
- A repair iteration whose agent returns `blocked` ends repair immediately with `ready_finalize_failed`; no further attempts. Rules out re-prompting over a self-declared blocker.
- Otherwise the agent's terminal token is not consulted — the re-run gate is the only verdict. Rules out trusting a `done` over a still-red gate.
- Each repair attempt appends a `ready_gate_repair` log entry (attempt number, gate exit code) to the run log. Rules out a run log where three extra agent invocations appear with no reason.

## Task checklist

- [ ] Add `prompts/write/ready-repair.md` + registry entry.
- [ ] Add the `ready_gate_repair` log event to `v2/src/persistence/log-stream.ts`.
- [ ] Wrap the two `publishCompletionArtifacts` call sites in `write-loop.ts` with the bounded repair loop.
- [ ] Cover in `v2/src/execution/write-loop.test.ts` with injected `readyFinalizer` seams.

## Acceptance criteria

- [ ] A red ready gate re-invokes the agent with the gate command, exit code, and output, then re-runs the gate; on a green re-run the PR flips to ready and the run outcome is `complete`. A new `write-loop.test.ts` case asserts this and fails against the pre-fix code.
- [ ] A gate that stays red is retried at most 3 times, then returns retryable `ready_finalize_failed` with the PR left draft (test asserts the invocation count and the outcome).
- [ ] Repair iterations count against `maxIterations`; a run that exhausts its budget mid-repair returns `ready_finalize_failed` (test).
- [ ] A repair iteration returning `blocked` stops repair immediately with `ready_finalize_failed` (test).
- [ ] A `gh pr ready` flip failure returns `ready_finalize_failed` with no repair invocation (test).
- [ ] Each repair attempt is visible in the run log as an iteration plus a `ready_gate_repair` entry naming the attempt number and gate exit code.

## Documentation updates

- `v2/docs/write-behavior.md` — ready finalization: bounded gate repair (cap, budget accounting, blocked/flip exits).
- `v2/docs/prompts.md` — the `write.ready-repair` artifact.
- `v2/docs/operator-runbook.md` § Gate trust — a red gate is repaired by the agent before it reaches the operator; drop "hand-fix the tree and push".
