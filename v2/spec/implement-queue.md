# v2 implement queue

Authority: operator priorities. Updated 2026-08-06.

## Goal

**Both keystones from the 2026-08-05 session are now fully landed:** the mutation-checkpoint verifier full-block fix and the `implement-completion-honesty` bundle (all three subspecs). Implement completion is now honest about stale/dirty worktrees, false `no-work` `completed`, and resumable `iteration_timeout`. The next session should land the **implement-blocker cluster** first (the three friction sources that hand-blocked every subspec this session), then the remaining seeds, then TUI slice 6.

## Start here next (in order)

1. **The implement-blocker cluster — land these three together or back-to-back; they hand-blocked every subspec of `implement-completion-honesty` this session and recur across sessions:**
   - `seeds/implement-reconciles-mutation-directive-to-landed-code` — **NEW.** Plan-authored `@mutate` directives quote unwritten call syntax → `target_absent` hard-block on otherwise-correct code. Should reprompt the agent to retarget, not settle `resumable: false`.
   - `seeds/implement-completion-commit-runs-formatter` — implement commits unformatted code **and** over-complexity; CI `check` / the ready-gate autofix fails. Formatter is autofixable; cognitive complexity is **not** (needs a `biome-ignore` or helper extraction) — cover both.
   - `seeds/implement-review-publication-successor-stalls-indefinitely` — the publication successor dispatches minutes after write+review settle; an operator who reads "no PR yet" races it (did so this session). Successor watchdog / observable publication row.
2. `seeds/intent-workflow-lacks-stale-workspace-reset` — killed intent strands a verdict marker; next intent run fails non-retryably.
3. The other open seeds below, then TUI slice 6.

## Landed 2026-08-06 (this session)

| Thread | PRs |
| --- | --- |
| **`mutation-verifier-resolves-from-full-bullet-block`** (wrapped mutation-checkpoint refs resolve) | #2618, #2619, #2620 |
| **`implement-completion-honesty`** (full: preflight gates + write-loop settlements + daemon projection) | #2621, #2622, #2623 (00), #2624 (01), #2625 (02) |
| Operator docs + new seed | this session's close PR |

Notes: seed 2's intent over-split into 4; consolidated to ONE ready-intent → one spec with three ordered subspecs. Every subspec hand-finished from a block (directive `target_absent` + biome complexity). Subspec 00's descendant gate correctly **dogfooded itself**, refusing stale reuse on re-dispatch.

## Landed 2026-08-05 (prior session)

| Thread | PRs |
| --- | --- |
| Bundle 1: mutation-checkpoint-verifier-trust | #2602, #2603, #2604 |
| Claude blindness fix (`--include-partial-messages`) | #2605, #2606, #2607, #2609 |
| Bundle 2 branch: criteria-based-subspec-routing (Problem B) | #2613 |
| Harness-defect seeds | #2608, #2611, #2614 |

| TUI slice | Shipped |
| --- | --- |
| 1–5 | complete |
| 6 — steering + log | **not seeded** |

## Open seeds — in recommended order

| Order | Seed | Notes |
| --- | --- | --- |
| 1 | `seeds/implement-reconciles-mutation-directive-to-landed-code` | **NEW.** `target_absent` `@mutate` should reprompt, not hard-block. Recurs every subspec. |
| 2 | `seeds/implement-completion-commit-runs-formatter` | Unformatted + over-complexity commits fail the gate; complexity is not autofixable. |
| 3 | `seeds/implement-review-publication-successor-stalls-indefinitely` | Publication successor dispatches late; operators race it. |
| 4 | `seeds/intent-workflow-lacks-stale-workspace-reset` | Killed intent strands a verdict marker; next intent run fails non-retryably. |
| 5 | `seeds/gate-repair-fence` | out-of-scope classification, repair write fence, autofix-turns-tree-red. |
| 6 | `seeds/pipeline-stage-settlement-honesty` | pipeline marks implement `failed` while the run is still live. |
| 7 | `seeds/mutation-checkpoint-criterion-must-name-enclosing-test` | strict linker needs the criterion to name its enclosing test. |
| 8 | `seeds/pipeline-plan-stage-orphans-ready-intent` | Pipeline plan stage doesn't consume its ready-intent. |
| 9 | `seeds/plan-review-must-falsify-guard-premises` | Extends the verifier bundle 1 rewrote. |
| 10 | `seeds/plan-intent-write-steps-lint-own-markdown` | Small, standalone. |
| 11 | `seeds/intent-landing-contract-rejects-wrapped-bullets` | Small, standalone. |

`seeds/tui-waitstate-is-polled-but-no-longer-rendered` rides TUI slice 6.

## Carried operator notes

- **Every implement subspec this session hand-blocked twice: (1) a plan-authored `@mutate` directive quoting call syntax the agent wrote differently → `target_absent`; (2) agent cognitive complexity the ready-gate autofix can't repair.** Fix per blocker: retarget the directive to the unique real call site and verify it reddens (apply → run pinning test → expect fail → revert); add a `biome-ignore lint/complexity/noExcessiveCognitiveComplexity` (or extract a helper preserving guard text). Both are seeded (queue items 1–2).
- **The publication successor is a THIRD run row that appears minutes after write+review settle.** Do NOT conclude "publication skipped" from "no PR yet" and hand-finish — you will race its push (`completion_commit_failed` non-fast-forward). Check `jarvis run list --branch <spec-dir>` for the publication row and let it settle. Seeded (queue item 3).
- **Consolidate an over-split bundled seed into ONE ready-intent by hand.** The intent workflow over-splits a deliberately-bundled seed (implement-completion-honesty → 3 ready-intents whose own `## Bundle` sections said "plan drafts one spec from the three" — but `plan` consumes only one). Rewrite the intent branch to a single consolidated ready-intent → one spec, ordered subspecs.
- **`resetStaleWorkspace` now refuses stale reuse (descendant gate, landed this session).** After merging a subspec increment and re-dispatching for the next, the old worktree is not a descendant of the new base → `jarvis cleanup --abandon <branch> --yes`, then re-dispatch.
- **The daemon auto-bounces to the merged build** (observed loaded→current after each merge); a transient `no daemon is listening` can appear mid-bounce — retry the command.
- **`jarvis cleanup --abandon <branch> --yes`** works non-interactively.
- **`jarvis config set-agents` takes a CSV arg** (`claude,cursor`), not space-separated.
- **A `completed`/`no-work` implement row can have committed nothing.** Confirm by PR, not status.
- **CI does not run `lint:md`.** Run it locally before merging any markdown-touching PR.
- **`jarvis run kill` and `jarvis cleanup` are classifier-gated** in auto mode; hand them to the operator's own shell when blocked.
