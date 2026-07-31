# v2 implement queue

Authority: operator priorities. Rebuilt 2026-07-31 after the overnight session.

## Start here next

The 2026-07-31 overnight session cleared every actionable item. What remains is deliberately
deferred; pick by what the next session actually hits.

1. Convert `seeds/human-only-marker-read-from-first-line-only` — **highest value open item.**
   The `(Manual)` marker is trailing-anchored and read from the first line only, while plan
   agents write it leading and wrapped. It stranded five runs at `contract_miss` this session
   on criteria the agent could not satisfy.
2. Convert `seeds/iteration-timeout-discards-completed-subspecs` — a timeout's only recovery
   retires the branch, discarding finished subspecs. Cost a hand-finish on a 3-subspec spec,
   and the same hazard destroyed a pushed commit via `--reset-despite-dirty`.
3. Convert `seeds/gate-repair-does-not-run-the-formatter` — formatter-only red gates exhaust the
   repair budget; hand `bun run fix` + resume is the standing stopgap, used repeatedly.
4. `ready-intents/guard-bare-settimeout-in-deterministic-tests.md` — retry now that #2370 names
   the real normalizer reason (three prior dispatches settled on an opaque `artifact.exists`).
5. Everything else in the seed tables below, by cost of not fixing.

## Rule

No phase is open. Reliability and dogfooding-discovered defects are the lane; pick up a phase
brief only when the operator opens one.

## Phase gate — per-project pipelines: **COMPLETE and dogfooded**

`jarvis pipeline start | list | wait | approve | reject | resume` works end to end, **including
a splitting intent** — the normal intent outcome, which the six-slice phase never covered.

| Work | State |
| --- | --- |
| Slices 1–6 (definitions, records, execution, gates, CLI, terminal actions, e2e) | shipped |
| Inter-stage handoff: ready-intent file + prior-worktree resolution | shipped #2359, #2363 |
| Branch-keyed persistence, multi-file handoff, fan-out execution | shipped #2374, #2379, #2385 |
| Branch-aware operator CLI | shipped #2406 |
| `--seed <path>` identity and consumption | shipped #2409, #2411 |
| Stale `pipeline` block no longer refuses `implement` | shipped #2399 |

Operator walkthrough: [`first-workflow-walkthrough.md`](../docs/first-workflow-walkthrough.md)
§ Configured pipeline.

## Guard-inversion: **CLOSED**

Prevention (#2384), removal across shared/daemon/CLI/execution-loop/TUI (#2395, #2398, #2392, #2402),
and a static guard in `bun run check` (#2405) with **zero allowlist entries**. The only
`setInvert*ForTest` match outside `*.test.ts` is the rule text forbidding it.

Watch for the disguises, which a static guard cannot catch: production exports that exist only
for test import, and "inversion" tests asserting against locally-defined helpers rather than
production. Both appeared this session (#2406).

## Ready-intents (queued)

| File | Notes |
| --- | --- |
| `guard-bare-settimeout-in-deterministic-tests.md` | Retry now that #2370 names the normalizer reason |
| `aggregate-timeout-reaps-the-test-process-group.md` | Insert only if a hung descendant is observed |
| `split-v2-review-prompt-ids-from-v1.md` | Prereq to later review work only |

## Seeds (ordered by cost of not fixing)

| Seed | Why |
| --- | --- |
| `human-only-marker-read-from-first-line-only` | Trailing-anchored and first-line-only; stranded five runs this session on unsatisfiable criteria |
| `iteration-timeout-discards-completed-subspecs` | A timeout's only recovery retires the branch, discarding finished subspecs |
| `gate-repair-does-not-run-the-formatter` | Formatter-only red gates exhaust the repair budget |
| `out-of-scope-gate-classification-strands-caused-failures` | #2313's classifier calls a run-caused failure "out of scope" and advertises a resume that cannot help |
| `mutation-verification-artifact-reached-the-completion-commit` | A mutation shipped inside a completion commit with every local gate green |
| `queue-widget-refactor` | Operator-authored |

## Seeds (deferred / low)

`daemon-child-output-test-races-process-startup` (mitigated #2208, race remains),
`publication-tails-are-consolidated`, `materialization-base-drift-guard`,
`implement-review-bounds-diff-payload`, `review-checkpoint-reuse-is-not-scoped-to-a-dispatch`,
`set-agents-accepts-any-string-including-flags`, `reviewer-verification-command`,
`surface-the-completion-commit-error-instead-of-swallowing-it`,
`archival-refusal-names-why-owner-was-not-retired` (ship with next cleanup diagnostic touch).

## Carried operator notes

- **Review every implement diff with a subagent before merging.** Review caught something real
  in 8 of 11 implement PRs this session, none of which a green ready gate flagged: a destructive
  non-transactional migration (#2374), a module global written on every `contract_miss` in the
  daemon hot path (#2370), a silent coverage loss where the test count went *up* (#2412), and
  four "inversion" tests asserting against local helpers, one of which stayed green under a real
  mutation (#2406).
- **A rising test count can hide a coverage loss.** When a change converts a fixture rather than
  adding one, run the relevant mutation and compare kill counts against `main`.
- **Plans block on dependency chains, and that is correct.** Eleven plan runs settled `blocked`
  naming an unshipped sibling. Fan plans out only across intents with no shared prerequisite;
  otherwise ship the root first and re-run.
- **Do not pass `--reset-despite-dirty` on an incomplete spec you care about.** It retires the
  branch including the remote, destroying pushed commits. Recover with `git fsck --lost-found`.
- **Do not admin-merge over a red check.** It happened once here (#2417) and reddened `main`.
- **ink does not paint to a fake stdout on CI.** A TUI test asserting painted output cannot pass
  there — assert through the injected input hook and production monitor state instead. See seed
  `tui-tests-bypass-the-render-path`.
- `bun test` **does not typecheck.** When hand-finishing anything, run `bun run check` and
  `bun run typecheck`, not just the tests.
- **A large subspec can exceed the iteration ceiling**, and the timeout discards finished subspec
  work — see the seed. Split large subspecs at plan time.
- **Two worktrees survive `cleanup`:** `20260727T203911Z-intent-split-prompt-by-surface` (predates
  2026-07-30, holds modified files) and `20260731T040405Z-shared-drop-production-invert-hooks`
  (its work landed by hand as #2395). Inspect before forcing.
