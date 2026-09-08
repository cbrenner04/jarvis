---
name: harness-failures-must-be-falsifiable-without-source
---

# Harness failure messages state conclusions the operator cannot check without reading harness source

## Problem

Three unrelated failures on 2026-09-07 each cost 20+ minutes of diagnosis, and **every one was diagnosed by reading `v2/src`**. Each message was literally true and still pointed away from the cause. An operator on a non-jarvis project — the case [[resume-surfaces-admission-gate-refusal]] was filed from, in `chess-mvp-yolo-2` — has no such recourse, so the same three failures are terminal there.

This is not a message-polish concern. It is the difference between a gate that costs a retry and a gate that costs the run.

| Failure | What it said | What was true | What it took to find out |
| --- | --- | --- | --- |
| `plan: unlinked_numbered_subspec: 04-…md is not linked from index.md` | the subspec is not linked | it **was** linked, on its own line; the line carried a trailing `(after 00 and 03)` annotation, and `INDEX_LINK_PATTERN` anchors `$` at the link's closing paren | reading the regex in `publication-landing.ts:45` |
| `ready_gate_out_of_scope` — `ready gate failing paths also reproduce on main: v2/src/persistence/state-store.test.ts` | the failure pre-exists on base | 159/159 passed on **both** refs when the machine was idle; the base-ref probe flaked the same test it was checking | re-running the named path on both refs by hand |
| `completion_commit_failed` — `bun biome check --write --unsafe … failed:` + biome output | the autofix command failed | true, and it can **never** succeed: the findings are non-autofixable, so `run resume` re-enters the same autofix forever | reading `write-loop.ts:3300` and noticing `completion-commit.ts:88` already handles this |

Three shared defects:

1. **The message reports the checker's conclusion, not its expectation and observation.** "Not linked" is a verdict; "no line matched the link pattern — the closest line was `- [ ] [04 …](./04-….md) (after 00 and 03)`" is a fact the operator can act on without knowing the pattern exists.
2. **Nothing distinguishes *absent* from *present but unparseable*.** These have opposite fixes (write the link vs. fix the line), and both currently render as absent.
3. **Nothing says whether re-issuing can succeed.** Two of the three were **fixed points** — resume re-ran the identical failing step — while the row advertised `resumable: true` / `nextAction: resume`. An operator who trusts that field burns runs discovering it is wrong. (`ready_gate_out_of_scope` has the inverse error: `nextAction: stop` on a condition that a quiet machine clears.)

The cost is asymmetric for external operators in a third way: all three messages name **jarvis-internal** paths (`v2/src/persistence/state-store.test.ts`, harness commands) as if they were the operator's own code.

## Decisions

**One shared failure record, used by every workflow and every pipeline stage.** Intent, plan, and implement all settle through the same run-row and `failureDetail` seams, so a per-check or per-family fix reproduces this bug in the next check written. The unit of work is the shared type and its renderers, adopted at the existing call sites.

- Introduce one structured operator-facing failure record — expectation, observed value, optional near-miss candidate, and whether re-issuing can change the outcome — carried on both the durable run-row error and pipeline `failureDetail`; rules out free-form `{ message }` strings as the contract between harness and operator.
- Every workflow (`intent`, `plan`, `implement`) and every pipeline stage renders that record through one formatter, so the same failure reads identically from `run list`, `run wait`, `pipeline list`, and the TUI; rules out per-surface message construction that drifts.
- Checks over authored documents populate the near-miss field, distinguishing *no candidate found* from *candidate found but not matching*; rules out one message serving two opposite fixes.
- Retryability is a field on the record, derived at settlement by the code that knows whether re-issue re-runs the identical step; `resumable` / `nextAction` project from it; rules out a row advertising `resume` for a fixed point, or `stop` for a load-cleared condition.
- The record marks harness-internal paths distinctly from operator-repository paths; rules out a message that reads as a defect in the operator's own code.
- Adopt at the existing settlement call sites rather than rewriting the checks; rules out a repo-wide message audit as the unit of work, while still closing the class.

## Acceptance criteria

- [ ] A test proves the structured failure record round-trips on a durable run row and on a pipeline `failureDetail`, preserving expectation, observed, near-miss, and retryability.
- [ ] A test proves one formatter renders the same record identically for `run list`, `run wait`, and `pipeline list`; it fails if any surface constructs its own text.
- [ ] A test proves an `intent`, a `plan`, and an `implement` failure each carry the record — the shared path is adopted by all three workflows, not one family.
- [ ] A test proves an unlinked-subspec failure whose index holds a near-miss line reports that line as unmatched, distinctly from the no-line case; it fails against the current single message.
- [ ] A test proves a settlement whose re-issue re-runs the identical failing step reports non-retryable and does not project `nextAction: resume` — covering ready-gate autofix over non-autofixable findings ([[ready-gate-autofix-strands-on-unfixable-lint]]).
- [ ] A test proves harness-internal paths are marked distinctly from operator-repository paths in the rendered record.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — a short "reading a contract failure" section: expectation, observed, near-miss, and whether re-issue can help.
- `v2/docs/coding-standards.md` — operator-facing failures state expectation and observation, never a bare verdict.
