# v2 implement queue

Authority: operator priorities. Updated 2026-08-04.

## Goal

**The Ready queue is empty.** The pipeline-trustworthiness thread is fully landed, and the completion-commit-error chain (emit → project → render) is complete. The two remaining threads are both *new* investment, not burn-down: **TUI slice 6** (steering + log — unseeded) and the **seed bundles** below (defects that need `intent` → `plan` before they can be implemented).

## Start here next

Pick one:

- **`seeds/mutation-checkpoint-verifier-trust`** — bundles the three verifier seeds (unparseable directives pass the gate, prose-mention selection, verification outliving its run) into one intent → plan. Land it first: every other seed's `@mutate` acceptance criteria run through the verifier it fixes, and dud pins ticked green on #2591 and #2597 this session plus a 40% cost over-bill earlier.
- **TUI slice 6 (steering + log)** from [tui-overhaul-brief.md](tui-overhaul-brief.md) — the last TUI slice, still unseeded. Fold in `seeds/tui-waitstate-is-polled-but-no-longer-rendered`. Needs a seed → `intent` → `plan` first.

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

## Open seeds — bundled 2026-08-04, in recommended order

Fifteen seeds folded into five bundles + four standalones. Each bundle shares one surface (same files, same doc sections), so one intent → plan → implement lands it without near-serial implement runs conflicting in the same code.

| Order | Seed | Absorbs | Why |
| --- | --- | --- | --- |
| 1 | `seeds/mutation-checkpoint-verifier-trust` | unparseable-directives, prose-mention selector, verification-outlives-run | All three in `mutation-checkpoint-verifier.ts`; the gate policy depends on the selection fixes; landing it makes every later seed's `@mutate` checkpoints trustworthy. |
| 2 | `seeds/implement-completion-honesty` | stale-dirty rerun, index-checkbox router, iteration-timeout retirement | Three ways a `completed` row lies; decides the two new `resetStaleWorkspace` gates' precedence once. |
| 3 | `seeds/gate-repair-fence` | out-of-scope classification, repair write fence, autofix-turns-tree-red | One repair pipeline: probe scope on base, fence writes to the same allowset, verify autofix output. |
| 4 | `seeds/pipeline-stage-settlement-honesty` | entry-run settlement, plan-PR-merge base break | One settlement surface: liveness re-check, run-error-derived stage reasons, base-ref fallback. |
| 5 | `seeds/implement-review-publication-successor-stalls-indefinitely` | — | Successor watchdog; standalone. Repro must be synthetic once bundle 2 lands. |
| 6 | `seeds/plan-review-must-falsify-guard-premises` | — | After bundle 1 — its keystone mechanism extends the verifier bundle 1 rewrites. |
| 7 | `seeds/plan-intent-write-steps-lint-own-markdown` | split from plan-output seed | Small, standalone: plan/intent write steps lint their own staged Markdown. |
| 8 | `seeds/intent-landing-contract-rejects-wrapped-bullets` | — | Small, standalone; reuses the shared bullet-block helper. Blocked two intent runs 2026-08-01. |

`seeds/tui-waitstate-is-polled-but-no-longer-rendered` rides TUI slice 6 (see the brief), not this queue order.

## Rule

TUI slice 6 and the seed bundles are the two active threads; both are new investment. Nothing is in the Ready queue.

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
