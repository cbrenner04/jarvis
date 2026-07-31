# v2 implement queue

Authority: operator priorities. Rebuilt 2026-07-31 (overnight session).

## Start here next

1. **Finish the mutant fix.** `ready-intents/*-drop-production-invert-hooks.md` (shared, daemon, CLI,
   execution-loop), then `ready-intents/guard-production-test-flags.md` **last** — the static guard
   cannot go green until the existing hooks are gone. The prompt-level prevention already shipped
   (#2384). Note for the guard's implementer: it must exempt `shared/prompts/step-rules.ts`, whose
   rule text quotes the forbidden identifiers.
2. **Finish pipeline fan-out.** `20260731T030451Z-pipeline-intent-split-fan-out-execution` is in
   flight (#2385); `ready-intents/pipeline-branch-operator-cli.md` is blocked until it lands. After
   both, a splitting intent walks per branch and `full-review` is usable unattended.
3. Convert `seeds/pipeline-start-seed-path-loses-file-identity` — every `pipeline start --seed`
   produces a frontmatter-derived branch slug and never consumes the seed file.
4. `ready-intents/intent-landing-contracts-reprompt-before-settle.md` — both intents run this
   session died at landing on a shape contract and needed a hand-edit plus resume.
5. Drain the two planned gate-repair specs: `20260730T222239Z-markdown-only-workflow-ready-repair-rejects-code-edits`,
   `20260730T222243Z-ready-gate-repair-cannot-extend-load-sensitive-files`. Run them **serially** —
   both extend the same `validateReadyGateRepairCompletion` seam.
6. Convert `seeds/pipeline-config-validation-blocks-unrelated-implement`.
7. TUI chrome: `ready-intents/terminal-window-renders-finishless-rows.md`,
   `expansion-driven-through-e-keybinding.md`.

## Rule

Two primary lanes: pipeline fan-out (makes pipelines usable unattended) and the mutant fix
(stops the defect that cost six implements in one session). TUI chrome is the parallel lane.

## Phase gate — per-project pipelines

Mechanism shipped and **proven against a real seed**. The first configured `full-review` run
exposed two gaps the six-slice phase did not cover; both are now the top of this queue.

| Work | State |
| --- | --- |
| Slices 1–6 (definitions, records, execution, approve/reject/resume, CLI, terminal actions, e2e) | shipped — see prior queue revisions |
| Inter-stage handoff: intent records a ready-intent **file** | shipped #2359 |
| Inter-stage handoff: stages resolve from the prior stage worktree | shipped #2363 |
| Branch-keyed stage persistence (`branch_key`, `downstreamInputs`) | shipped #2374 |
| Multi-file intent downstream handoff | shipped #2379 |
| Fan-out execution (resolve + execute + e2e) | **in flight** #2385 |
| Branch-aware `pipeline list` / `wait` / `approve` / `reject` | blocked on fan-out execution |

Operator walkthrough: [`first-workflow-walkthrough.md`](../docs/first-workflow-walkthrough.md)
§ Configured pipeline.

**A pipeline still cannot survive a splitting intent** until item 2 lands. A split is the *normal*
intent outcome, so today only a seed that yields exactly one ready-intent walks past plan.

## Mutant-fix lane (guard-inversion)

The defect: a plan acceptance criterion saying "inverting the guard makes the test RED" gets
satisfied by adding a production invert hook. That hook is dead code, and twice it produced an
**unkillable mutant** that failed the run with `surviving_mutation_failed` (#2360, #2379). It hit
six implements this session; four needed a hand-fix.

| Work | State |
| --- | --- |
| Write-step rules forbid production invert hooks, require source mutation | shipped #2384 |
| Drop hooks: shared / daemon / CLI / execution-loop | planned (shared #2386, CLI #2387); daemon + execution-loop need re-plan |
| Static guard rejecting all four hook shapes under `bun run check` | **last** — blocked until the drops land |

Evidence the prompt fix works: #2376 was the first implement of the session with zero production
test flags, after its criterion was reworded pre-merge.

## Reliability lane

| Work | State |
| --- | --- |
| Ready-gate repair fences `.jarvis-*` harness sidecars | shipped #2360 |
| Plan-draft normalizer message reaches `failureReason` and the blocker | shipped #2370 |
| `contract_miss` reason surfaces on `run list` / `run wait` rows | shipped #2376 |
| Migrations run in a transaction (020 was destructive and unwrapped) | shipped #2374 |
| Markdown-only repair fence, load-sensitive repair fence | planned, not run |

## Ready-intents (queued)

| File | Notes |
| --- | --- |
| `shared-drop-production-invert-hooks.md` | Planned #2386 |
| `cli-drop-production-invert-hooks.md` | Planned #2387 |
| `daemon-drop-production-invert-hooks.md` | Plan settled `contract_miss`; re-plan |
| `execution-loop-drop-production-invert-hooks.md` | Plan blocked; re-plan now that #2384 landed |
| `guard-production-test-flags.md` | **Last** in the mutant-fix chain |
| `pipeline-branch-operator-cli.md` | Blocked on fan-out execution |
| `intent-landing-contracts-reprompt-before-settle.md` | Two hand-fixes this session |
| `terminal-window-renders-finishless-rows.md` | TUI chrome |
| `expansion-driven-through-e-keybinding.md` | TUI chrome |
| `aggregate-timeout-reaps-the-test-process-group.md` | Insert only if a hung descendant is observed |
| `guard-bare-settimeout-in-deterministic-tests.md` | Low; three plan dispatches settled `contract_miss`. Retry now that #2370 names the real normalizer reason |
| `split-v2-review-prompt-ids-from-v1.md` | Prereq to later review work only |

## Seeds (ordered by cost of not fixing)

| Seed | Why |
| --- | --- |
| `pipeline-start-seed-path-loses-file-identity` | Frontmatter-derived branch slug, and the seed file is never consumed; hits every `pipeline start --seed` |
| `iteration-timeout-discards-completed-subspecs` | A timeout's only recovery retires the branch, discarding finished subspecs; cost a hand-finish on a 3-subspec spec |
| `pipeline-config-validation-blocks-unrelated-implement` | A stale `projects.<name>.pipeline` block refuses `implement`, which never reads pipelines |
| `out-of-scope-gate-classification-strands-caused-failures` | #2313's classifier calls a run-caused failure in an unedited file "out of scope" and advertises a resume that cannot help |
| `mutation-verification-artifact-reached-the-completion-commit` | A mutation shipped inside a completion commit with every local gate green; CI caught it |
| `gate-repair-does-not-run-the-formatter` | Formatter-only red gates exhaust the repair budget; hand `bun run fix` + resume is the standing stopgap |
| `human-only-marker-read-from-first-line-only` | A wrapped `(Manual)` criterion blocked two implement dispatches |

## Seeds (deferred / low)

`daemon-child-output-test-races-process-startup` (mitigated #2208, race remains),
`publication-tails-are-consolidated`, `materialization-base-drift-guard`,
`implement-review-bounds-diff-payload`, `review-checkpoint-reuse-is-not-scoped-to-a-dispatch`,
`set-agents-accepts-any-string-including-flags`, `reviewer-verification-command`,
`surface-the-completion-commit-error-instead-of-swallowing-it`,
`archival-refusal-names-why-owner-was-not-retired` (ship with next cleanup diagnostic touch).

## Carried operator notes

- **Plans block on dependency chains, and that is correct.** Seven plan runs this session settled
  `blocked` naming an unshipped sibling. Fan plans out only across intents with no shared
  prerequisite; otherwise ship the root first and re-run.
- **A large subspec can exceed the iteration ceiling** and the timeout discards finished subspec
  work — see the seed. The pipeline-resolve spec hit it with subspecs 00 and 01 complete; it was
  hand-finished (#2363). Split large subspecs at plan time.
- `bun test` **does not typecheck.** When hand-finishing anything, run `bun run check` and
  `bun run typecheck`, not just the tests.
- **Review every implement diff with a subagent before merging.** Six of this session's implements
  needed a hand-fix that a green gate did not catch, including a destructive unwrapped migration
  (#2374) and a module global written on every `contract_miss` in the daemon hot path (#2370).
- **A left-over worktree may not be this session's.**
  `~/.jarvis/worktrees/jarvis/20260727T203911Z-intent-split-prompt-by-surface` holds modified and
  untracked files and refuses bulk retirement; it predates 2026-07-30. Inspect before forcing.
