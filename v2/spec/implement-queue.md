# v2 implement queue

Authority: operator priorities. Updated 2026-08-04.

## Goal

**The Ready queue is empty.** The pipeline-trustworthiness thread is fully landed, and the
completion-commit-error chain (emit → project → render) is complete. The two remaining threads are
both *new* investment, not burn-down: **TUI slice 6** (steering + log — unseeded) and the **open
seeds** below (defects that need `intent` → `plan` before they can be implemented).

## Start here next

Pick one:

- **TUI slice 6 (steering + log)** from [tui-overhaul-brief.md](tui-overhaul-brief.md) — the last TUI
  slice, still unseeded. Fold in `seeds/tui-waitstate-is-polled-but-no-longer-rendered`. Needs a seed
  → `intent` → `plan` first.
- **Highest-value open seed:** `seeds/unparseable-mutation-directives-pass-the-gate` — a
  `target_absent` / unparseable `@mutate` directive is stderr-only and does not fail the gate
  (`write.ts` checks only `report.hollow`, ignores `unparseable`). It let dud pins tick green on
  #2591 and #2597 this session and a 40% cost over-bill earlier. Fixing it closes the whole
  hollow/dud-pin class.

## Landed this session (2026-08-04)

| Thread | PRs |
| --- | --- |
| Fan-out: branch-scoped artifacts + concurrent sibling dispatch | #2584, #2585, #2586 |
| Harness-defect seeds (successor-stall, index-router) | #2587 |
| Durable pipeline stage dispatch claim (store + partition-time) | #2588, #2589 |
| Settlement-first fan-out terminality | #2590, #2591 |
| Split v2 review prompt ids from v1 | #2592, #2593 |
| Completion-commit-error chain: emit → project → render | #2594–#2599 |

| TUI slice | Shipped |
| --- | --- |
| 1–5 | complete (see prior queue history) |
| 6 — steering + log | **not seeded** |

## Open seeds, newest first

| Seed | Why |
| --- | --- |
| `seeds/implement-review-publication-successor-stalls-indefinitely` | Review/shrink/publication successor steps hang after `iteration_started` with no watchdog, holding the branch claim; recovery only via `jarvis run kill`. Hit `c6bf9b42`, `503f2683` on 2026-08-04. |
| `seeds/implement-router-reselects-fully-ticked-subspec-by-index-checkbox` | Router routes by index checkbox not criteria, so a hand-finished subspec no-ops the next run (`328c3cc6`; worked around by #2585). |
| `seeds/implement-rerun-completes-over-a-stale-dirty-worktree` | Implement re-run executed in a stale dirty worktree, read old ticks as truth, settled `completed` having committed nothing. Root cause unproven — first AC is a reproduction. |
| `seeds/entry-run-settlement-terminalizes-live-rows` | `applyEntryRunSettlement` writes `failed` + `endedAt` with no liveness re-check; remaining path to `startedAt == endedAt`. |
| `seeds/plan-review-must-falsify-guard-premises` | A "rules out X" criterion is only legitimate if X is reachable on `main`; nothing checks it. Cost three implement runs on the retired fan-out spec. |
| `seeds/plan-output-fails-lint-md-and-repair-edits-unrelated-source` | Plan drafts finalize without linting their own Markdown; repair rewrites unrelated source and commits nothing. |
| `seeds/pipeline-implement-stage-breaks-when-its-plan-pr-merges` | Implement stage bases its PR on the plan branch, so merging the pipeline's own plan PR kills it with `Base ref must be a branch`. |
| `seeds/unparseable-mutation-directives-pass-the-gate` | An unresolvable / `target_absent` `@mutate` directive is stderr-only and does not fail the gate. **Recurred on #2591 and #2597 this session.** Highest-value open seed. |
| `seeds/mutation-verification-outlives-its-run` | An `iteration_timeout` stranded applied `@mutate` directives in production source. |
| `seeds/gate-autofix-can-turn-a-green-tree-red` | `bun run fix` rewrites `findIndex` → `indexOf` on a possibly-`undefined` needle; cannot self-repair. |
| `seeds/mutation-selector-fires-on-prose-mentions-of-the-marker` | Selects on a bare `@mutate` substring, so a spec discussing the marker in prose fails its own gate. |
| `seeds/tui-waitstate-is-polled-but-no-longer-rendered` | Slice 4 left `waitState` with no reader while the `wait` RPC still fires. Fold into slice 6. |
| `seeds/intent-landing-contract-rejects-wrapped-bullets` | Blocked two intent runs on 2026-08-01. |
| `seeds/iteration-timeout-discards-completed-subspecs` | Bit repeatedly; workaround: split large subspecs at plan time. |
| `seeds/out-of-scope-gate-classification-strands-caused-failures` | Run-caused test failures classified out of scope (#2313). |

## Rule

TUI slice 6 and the open seeds are the two active threads; both are new investment. Nothing is in the
Ready queue.

## Carried operator notes

- **Verify by exit code, never by output text.** A hung test file contributes nothing to the tally, so a `2611 pass / 0 fail` summary can sit over a slice that exited 1.
- **After any mutate/restore cycle, diff the tree before committing.** And commit a hand-fix *before* running mutation verification — the verifier's `git checkout -- <file>` restore silently wipes uncommitted edits (bit twice this session: `resolve.ts`, `pipeline-execution.ts`).
- **A `completed`/`no-work` implement row can have committed nothing** (`328c3cc6`, `eabc39a7`). Confirm by PR, not status.
- **A settled write step spawns successor steps that can stall or fail late.** After a workflow "finishes", check for live rows on the *branch* and for a draft PR from a `completion_commit_failed` tail — not just the run id you launched.
- **Agent-written functions recurrently trip the cognitive-complexity gate** (`aggregateFanOutBranchSuffix` #2591, `runIntentResumeCommitAndPublish` #2595) → `completion_commit_failed` + red CI. Not autofixable and repair can't fix it; hand-extract a helper, preserving guard-condition text so `@mutate` directives still resolve.
- **cursor idle-times-out on some specs** (two `idle_output_timeout` on the prompt-split spec, real work on disk then 90s silence). Non-retryable; switch to claude-first and re-run with `--reset-despite-dirty`.
- **Review every implement diff with a subagent before merging.** Every review this session found something real — inert/dud `@mutate` pins on otherwise-correct code (#2591, #2597), a mislocated criterion (#2586). Production was usually right; the pins were the defect.
- **CI does not run `lint:md`.** Run it locally before merging any markdown-touching PR.
- **Plan finalization rejects multi-surface acceptance-criteria bullets.** The render plan blocked twice on one; hand-author the spec (split the AC into atomic bullets) rather than re-running.
- **`jarvis run kill` and `jarvis cleanup` are classifier-gated** in auto mode; hand them to the operator's own shell when blocked.
