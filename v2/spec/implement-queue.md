# v2 implement queue

Authority: operator priorities. Updated 2026-08-05.

## Goal

**Two keystones landed this session: the mutation-checkpoint verifier (bundle 1) and the
claude output-blindness fix.** claude-first review now works. The next session should land
the **verifier full-block resolution fix first** (it unblocks all mutation-checkpoint AC
authoring), then continue bundle 2, then the remaining seeds.

## Start here next (in order)

1. **`seeds/mutation-verifier-resolves-from-full-bullet-block`** (#2614) — **do this first.**
   One-line fix: `verifyMutationCheckpoints` resolves the pinning test from the criterion's
   first line only while selection reads the full bullet block, so a wrapped pinning-test ref
   goes `unresolved_pinning_test`/hollow and hard-blocks completion. This blocked the routing
   branch for ~35 min and forces every mutation-checkpoint AC onto one long line. Landing it
   makes wrapped mutation-checkpoint ACs Just Work. Author its own pin single-line (leading with
   the pinning-test file + enclosing test name) so it resolves under the current unfixed verifier.
2. **Bundle 2 remainder — `seeds/implement-completion-honesty`, as ONE spec (do NOT fan out).**
   Branch 1/4 (`criteria-based-subspec-routing`, seed Problem B) **landed via #2613**. Remaining:
   Problem A (stale-dirty rerun / preflight stale-workspace gates), Problem C (iteration-timeout
   conditional resume), and no-work-settlement-refuses-uncommitted-work. They share the
   `hasUncheckedNonHumanOnlyCriteria` predicate (now on main) and `workflow-runner.ts`, so run
   them as one cohesive spec with ordered subspecs — **the pipeline intent fan-out over-split
   this deliberately-bundled seed into 4 coupled branches** (see Carried notes).
3. The other open seeds below, then TUI slice 6.

## Landed this session (2026-08-05)

| Thread | PRs |
| --- | --- |
| **Bundle 1: mutation-checkpoint-verifier-trust** (keystone — dud pins now blocked) | #2602, #2603, #2604 |
| **Claude blindness fix** (`--include-partial-messages`; claude-first review works) | #2605, #2606, #2607, #2609 |
| **Bundle 2 branch 1/4: criteria-based-subspec-routing** | #2613 |
| Harness-defect seeds | #2608, #2611, #2614 |

| TUI slice | Shipped |
| --- | --- |
| 1–5 | complete |
| 6 — steering + log | **not seeded** |

## Open seeds — in recommended order

`seeds/mutation-checkpoint-verifier-trust` is **DONE** (#2604). New order:

| Order | Seed | Notes |
| --- | --- | --- |
| 1 | `seeds/mutation-verifier-resolves-from-full-bullet-block` | **NEW, do first.** Wrapped mutation-checkpoint refs go hollow; one-line fix. |
| 2 | `seeds/implement-completion-honesty` | **Routing (Problem B) done via #2613.** Remainder as ONE spec; do not fan out. |
| 3 | `seeds/intent-workflow-lacks-stale-workspace-reset` | **NEW.** Killed intent strands a verdict marker; next intent run fails non-retryably. |
| 4 | `seeds/gate-repair-fence` | out-of-scope classification, repair write fence, autofix-turns-tree-red. |
| 5 | `seeds/pipeline-stage-settlement-honesty` | liveness re-check (pipeline marks implement `failed` while the run is still live — hit twice this session). |
| 6 | `seeds/implement-completion-commit-runs-formatter` | **NEW.** Implement commits unformatted code; CI `check` fails (hit #2604, #2609, #2613). |
| 7 | `seeds/mutation-checkpoint-criterion-must-name-enclosing-test` | **NEW.** Post-bundle-1 strict linker needs the criterion to name its enclosing test. |
| 8 | `seeds/pipeline-plan-stage-orphans-ready-intent` | **NEW.** Pipeline plan stage doesn't consume its ready-intent. |
| 9 | `seeds/implement-review-publication-successor-stalls-indefinitely` | Successor watchdog; standalone. |
| 10 | `seeds/plan-review-must-falsify-guard-premises` | Extends the verifier bundle 1 rewrote. |
| 11 | `seeds/plan-intent-write-steps-lint-own-markdown` | Small, standalone. |
| 12 | `seeds/intent-landing-contract-rejects-wrapped-bullets` | Small, standalone. |

`seeds/tui-waitstate-is-polled-but-no-longer-rendered` rides TUI slice 6.

## Carried operator notes

- **claude-first review WORKS now** (#2609). The old "claude isn't slow, jarvis can't see it"
  lore is fixed for long no-tool turns via `--include-partial-messages`. Cursor still
  idle-times-out on some specs; claude write is fine, but `--review-passes 0` + claude-first is
  the fallback when a spec's write step idle-times-out on cursor.
- **Never run the standalone mutation verifier and then `git add -A`.** It applies each `@mutate`
  directive to the working tree (restoring between); a concurrent `git add -A` captured BOTH
  directives' mutations into the commit this session (routing #2613 shipped the inverted guard +
  reverted re-resolve, in opposite states, twice). Commit first, or verify via the daemon's own
  implement run. **Always subagent-review the diff before merge** — it caught this when a fast
  parser check did not.
- **Mutation-checkpoint ACs must be authored single-line until #2614 lands** (pinning-test file +
  enclosing test name on line 1), or resolution reads only line 1 and blocks completion.
- **The pipeline intent fan-out over-splits a deliberately-bundled seed** into coupled branches
  (bundle 2 → 4 branches sharing one predicate + `workflow-runner.ts`). Run bundled seeds as ONE
  spec; don't approve a 4-way fan-out for shared-surface work.
- **Pipeline marks the implement stage `failed` while the run is still live** (premature
  terminality — hit on both the blindness and routing pipelines). Ignore the pipeline's `failed`;
  monitor the actual run on the branch to real settlement. Covered by `pipeline-stage-settlement-honesty`.
- **`jarvis cleanup --abandon <branch> --yes`** works non-interactively (the `--yes` flag; the old
  "piped-y cancels / hand to operator" note is obsolete for `--abandon`).
- **`jarvis config set-agents` takes a CSV arg** (`claude,cursor`), not space-separated.
- **A `completed`/`no-work` implement row can have committed nothing.** Confirm by PR, not status.
- **CI does not run `lint:md`.** Run it locally before merging any markdown-touching PR. Implement
  also does not run `bun run check` (biome) — expect a format-CI failure and `bun biome check
  --write` before merge until #2611's formatter fix lands.
- **`jarvis run kill` and `jarvis cleanup` are classifier-gated** in auto mode; hand them to the
  operator's own shell when blocked.
