---
name: invocation-error-reports-the-prompt-and-records-nothing
---

# A failed plan dispatch reports its own prompt as the error and leaves no telemetry

## Problem

A `plan` dispatch can settle `invocation_error` / `resumable: false` / `nextAction: "stop"` with two properties that make it undiagnosable:

1. **`error.message` is the prompt, not an error.** The composed operator error carries the binding's bounded stderr tail, and that tail is the tail of the *plan draft prompt itself* — "If you draft a subspec and then rename or rewrite it, delete the old file …", ending mid-sentence in the `## File output` section. Nothing in it describes a failure.
2. **No telemetry row is written at all.** `~/.jarvis/telemetry.jsonl` has zero rows for the run, so there is no `agent`, `model`, `binding_id`, `exit_kind` or `exit_reason` to attribute it to. The per-role audit trail the runbook designates for exactly this question is empty.

Together the operator can determine only that *something* failed before any role invocation was recorded, with no way to tell which binding, or why.

## Evidence (2026-09-08)

Two consecutive dispatches of `plan --ready-intent v2/spec/ready-intents/distinguish-configured-and-default-missing-gates.md`, runs `056da7b7` and `d6e7a552`, settled identically at ~8s with `iterationsConsumed: 1`.

Ruled out:

- **Agent health** — `codex --version` (0.150.1), `cursor-agent --version` (2026.09.02-c22c1a3) and `claude --version` (2.1.263) all exit 0 immediately after the failures.
- **Quota exhaustion** — quota exits *do* produce telemetry rows (53 were recorded earlier in the same session); these produced none.
- **Input size or content** — the ready-intent is 2.3 KB, smaller than several that planned successfully the same session, with two ordinary non-ASCII characters.
- **A stale workspace** — `cleanup --abandon` between the two attempts; the second failed identically from a fresh worktree.

Other `plan` lanes dispatched successfully in the same session on the same daemon, so this is not a blanket dispatch outage.

## Decisions

- A binding failure records a telemetry row before it can settle the run, carrying at minimum the attempted `agent`, `model`, `binding_id` and a failure `exit_kind`; rules out a failure path that leaves the audit trail the runbook points operators at completely empty.
- When the captured stderr tail cannot be distinguished from echoed input, the operator error names the failure class and the attempted binding instead of pasting the tail; the raw tail stays available on `jarvis run log`; rules out presenting the prompt as the diagnosis.
- Every binding in the chain is accounted for in the settled error — which rungs were attempted and how each ended; rules out an unattributed failure when the flat agent list has three entries.
- Scope is the failure-reporting path, not the underlying spawn defect, which this seed does not claim to have identified; rules out a fix that assumes a root cause the evidence does not establish.

## Acceptance criteria

- [ ] A test proves a binding whose invocation fails before producing a result writes a telemetry row naming the agent, model and binding id with a failure `exit_kind`; it fails against the current no-row path.
- [ ] A test proves the settled operator error names the attempted bindings and a failure class rather than a captured stderr tail, when that tail matches the dispatched prompt.
- [ ] A test proves the raw stderr tail is still retrievable from `jarvis run log` for the same run.
- [ ] A test proves an ordinary role failure with real stderr keeps reporting that stderr, unchanged.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — § Reading telemetry: a binding failure always leaves a row, so an empty query is evidence of absence rather than an unrecorded failure; and § Review-role timeouts and stalls: what `invocation_error` names.
- `v2/docs/daemon-host.md` — binding-failure attribution on the composed operator error.
