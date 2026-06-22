# Test-suite audit findings

## Scan

- Command: `rg -l --glob '*.test.ts' '(spawn|execFile|exec|setTimeout|Date\.now|sleep|new Date\()' v1 v2 shared test | sort`
- Count from scan: `53`
- Re-scan check: manual pass found no extra primitive-touching `*.test.ts` files outside that list.

## Green basis

- Green is measured sandbox-off.
- `marked-exception` files are expected to run there, not be excluded.
- `bun test` does not emit stable per-file coverage numbers in the default repo flow, so the baseline below is the assertion inventory that 05 must preserve.

## Verdicts

### `already-deterministic`

| File | Primitive(s) | Why cleared |
| --- | --- | --- |
| `shared/invocation/execute.test.ts` | `exec` substring only | False positive from `execute*` identifiers; no real process or wall-clock dependence. |
| `shared/prompts/registry.test.ts` | `exec` substring only | False positive from `write.execute` prompt id. |
| `shared/worktree-lock.test.ts` | `new Date(` | Timestamp is fixture payload only; assertions do not derive from live time. |
| `v1/test/gh.test.ts` | `spawn` string | Uses injected fake spawn emitter; no real subprocess. |
| `v1/test/install-opencode-permissions.test.ts` | `new Date(` | Uses a fixed historical timestamp for `utimes`; no live clock. |
| `v1/test/prompt.test.ts` | `Date.now` | Temp-path suffix only; no assertion depends on wall-clock behavior. |
| `v1/test/pr.test.ts` | `execSync`, `execFileSync` | Real git is fixture-only for commit-message rendering; production subject under test is pure attribution formatting. |
| `v1/test/resolve-project.test.ts` | `execSync` | `git init` is bootstrap for ad-hoc repo detection; no process seam in asserted behavior. |
| `v1/test/review-feedback-command.test.ts` | `execSync` | Matches are setup helpers; command behavior is driven through injected command/agent seams. |
| `v1/test/triage-command.test.ts` | `execSync` | `git init` is fixture bootstrap for status rendering; no timing or real-process dependency in the command logic under test. |
| `v1/test/worktree-lock.test.ts` | `new Date(` | Timestamp is fixture payload only; assertions do not derive from live time. |
| `v1/test/plan-delete-ready-intent-command.test.ts` | `execSync` | Heavy git bootstrap, but the assertions are about plan/intents behavior; no flaky wall-clock/process smell surfaced in the exercised seam. |
| `v1/test/plan-draft-additional-read-dirs.test.ts` | `execSync` | Only commit-mode setup hits git; the asserted behavior uses injected agents. |
| `v1/test/plan-draft-hard-error-continue.test.ts` | `execSync` | Match is fixture bootstrap / command text, not a live timing or spawn dependency in assertions. |
| `v1/test/plan-inject-repo-line.test.ts` | `execSync` | Repo bootstrap only; asserted behavior is prompt injection. |
| `v1/test/plan-worktree.test.ts` | `execSync` | Real git is the fixture substrate for worktree path logic; no wall-clock smell. |
| `v1/test/prompts/rendered-snapshots.test.ts` | `spawn` string | Match comes from prompt text / fixtures, not runtime behavior. |
| `v1/test/modes/patch/reap.test.ts` | `spawn` comment text | Already the DI reference: no real process spawn, no live clock. |
| `v1/test/modes/prompt/run.test.ts` | `execSync` | Real git is fixture bootstrap; agent/process interactions are injected. |
| `v1/test/modes/review/run.test.ts` | `execSync` | Real git is fixture bootstrap; review execution uses injected adapters. |
| `v2/src/cli.test.ts` | `exec` substring only | False positive from `executeWriteLoop` identifiers. |
| `v2/src/step-runner.test.ts` | `exec` substring only | False positive from `execute.ts` import path. |
| `v2/src/write-prompt.test.ts` | `exec` substring only | False positive from `write.execute` prompt id. |

### `refactor`

| File | Primitive(s) | Cluster | Seam / clock to inject |
| --- | --- | --- | --- |
| `v1/test/agents/aider.test.ts` | `spawn` | `01` | Inject the spawn/stdio recorder seam instead of executing a fake binary script. |
| `v1/test/agents/claude.test.ts` | `spawn` | `01` | Inject the spawn/stdio recorder seam instead of executing a fake binary script. |
| `v1/test/agents/codex.test.ts` | `spawn`, `exec` argv text | `01` | Inject the spawn/stdio recorder seam instead of executing a fake binary script. |
| `v1/test/agents/cursor.test.ts` | `spawn` | `01` | Inject the spawn/stdio recorder seam instead of executing a fake binary script. |
| `v1/test/agents/opencode.test.ts` | `spawn` | `01` | Inject the spawn/stdio recorder seam instead of executing a fake binary script. |
| `v1/test/run.test.ts` | `execSync`, `setTimeout`, `Date.now`, `sleep`, `spawn` | `02` | Inject clock + poller for elapsed/interrupt assertions; route descendant/process interaction through injected spawn / `DescendantTracker` seams. |
| `v2/src/write-loop.test.ts` | `execFileSync` | `05` | Inject `withExternalWorktree` / git-materialization seam so loop assertions do not need a real repo/worktree. |
| `v2/src/write.test.ts` | `execFileSync` | `05` | Inject `withExternalWorktree` / git-materialization seam so write-step assertions do not need a real repo/worktree. |

### `marked-exception`

| File | Primitive(s) | Cluster | Required OS/git seam |
| --- | --- | --- | --- |
| `shared/git.test.ts` | `execFileSync` | `05` | Real `git` CLI behavior for branch lookup / remote-tracking refs. |
| `shared/preload.test.ts` | `spawnSync` | `05` | Real process launch to prove Bun preload mutates `PATH` for the shared slice. |
| `test/test-slices.test.ts` | `execSync` | none | Nested `bun test` subprocesses to prove scoped slice runs honor preload wiring. |
| `v1/test/agents/spawn.test.ts` | `setTimeout`, `sleep` | `01` | Real subprocess / process-group behavior of `runAgent`, including env and orphan cleanup. |
| `v1/test/cleanup-command.test.ts` | `execSync` | `03` | Real git branch/worktree/remote behavior for cleanup semantics. |
| `v1/test/cli.test.ts` | `Bun.spawnSync` | `03` | Real OS exec through the `bin/jarvis1` symlink path. |
| `v1/test/intent-command.test.ts` | `execSync` | `03` | Real git remote/branch state for intent command commit-mode behavior. |
| `v1/test/plan-command.test.ts` | `execSync`, `Date.now`, `sleep` | `03` | Real git/gh/worktree command flow for large plan-mode integration coverage. |
| `v1/test/plan-end-to-end.test.ts` | `execSync` | none | Real repo + remote plan-mode smoke path. |
| `v1/test/ready-gate.test.ts` | `execSync` | none | Real git HEAD / dirty-worktree state transitions for tier selection. |
| `v1/test/ready-script.test.ts` | `execFileSync`, `sleep` | `03` | Real subprocess deadline/exit semantics for `runCommand`. |
| `v1/test/modes/patch/pr.test.ts` | `execSync` | `04` | Real git history / branch state for PR body and draft/ready semantics. |
| `v1/test/modes/patch/review.test.ts` | `execSync` | `04` | Real repo / branch / remote state for review-flow integration behavior. |
| `v1/test/modes/patch/shrink.test.ts` | `execSync` | `04` | Real git history rewriting / branch movement semantics. |
| `v1/test/modes/patch/subspec.test.ts` | `execSync`, `execFileSync` | `04` | Real git commit-message history for subspec attribution / parsing behavior. |
| `v1/test/modes/plan/boundary.test.ts` | `execFileSync` | `04` | Real git history and filesystem state for boundary-diff behavior. |
| `v1/test/modes/plan/commits.test.ts` | `execSync` | `04` | Real git worktree / commit / trailer behavior. |
| `v1/test/modes/plan/git-porcelain.test.ts` | `execFileSync` | `04` | Real git porcelain output contract. |
| `v1/test/modes/plan/pr.test.ts` | `execSync`, `execFileSync` | `04` | Real git commit / diff state for plan PR rendering and commit selection. |
| `v1/test/modes/plan/review.test.ts` | `execSync`, `execFileSync` | `04` | Real git worktree / review-flow repository state. |
| `v2/src/external-worktree.test.ts` | `execFileSync` | `05` | Real `git worktree` / branch materialization behavior. |
| `v2/src/preload.test.ts` | `spawnSync` | `05` | Real process launch to prove Bun preload mutates `PATH` for the v2 slice. |

## Assertion baseline

- `shared/git.test.ts`: local branch lookup; origin-tracking branch lookup after fetch; current branch reporting after checkout.
- `shared/preload.test.ts`: shared-slice preload prepends the fake-agent bin dir; fake `codex --version` runs successfully through that preload.
- `test/test-slices.test.ts`: directory ownership of `*.test.ts`; package scripts use exact scoped roots; preload path points at `test/setup-fake-agents.ts`; scoped `bun test` runs inherit preload; ready script uses aggregate `test`.
- `v1/test/agents/aider.test.ts`: argv contract, cwd, stdin/stdout/stderr mapping, env shaping, exit/result classification.
- `v1/test/agents/claude.test.ts`: argv contract, stdin piping, cwd, stderr/stdout handling, exit/result classification, fixture parsing expectations.
- `v1/test/agents/codex.test.ts`: argv contract including sandbox/approval/model/add-dir flags, stdin piping, cwd, stdout/stderr handling, result classification.
- `v1/test/agents/cursor.test.ts`: argv contract, cwd, stdout/stderr handling, result classification.
- `v1/test/agents/opencode.test.ts`: argv contract, cwd, stdout/stderr handling, JSON-stream parsing, result classification.
- `v1/test/agents/spawn.test.ts`: child `PWD` normalization, `OLDPWD` stripping, child cleanup/orphan reap, retry counting, abort-before-retry behavior.
- `v1/test/cleanup-command.test.ts`: merged-worktree cleanup, branch/remote deletion paths, rename/reporting behavior, dirty/active-worktree protections.
- `v1/test/cli.test.ts`: symlinked `bin/jarvis1` resolves repo path and prints help cleanly.
- `v1/test/intent-command.test.ts`: intent creation/update flows, ready-intent handling, commit-mode git integration, additional-read-dirs propagation.
- `v1/test/plan-command.test.ts`: large plan-mode integration surface including worktree creation, GitHub/PR stubs, retry/review paths, repo/preload prompt wiring, elapsed/timing watchdog groups.
- `v1/test/plan-end-to-end.test.ts`: inline-intent `planCommand` smoke path over a real local+remote repo.
- `v1/test/ready-gate.test.ts`: fast/full tier selection from HEAD/dirty state; ready gate refresh behavior; dirty-tree commit path branching.
- `v1/test/ready-script.test.ts`: timeout parsing, invalid timeout warning, deadline exit `124`, normal/non-zero exit propagation, fast/full command lists, recorded-install digest behavior.
- `v1/test/run.test.ts`: unmerged-plan warnings, telemetry send timeout bound, registered-origin lazy population, dirty/clean completion exits, completion gate retry paths, early interrupt, elapsed bound, descendant capture.
- `v1/test/modes/patch/pr.test.ts`: attribution footer rendering across commits/spec trailers, dirty-tree handling, PR body/update behavior.
- `v1/test/modes/patch/review.test.ts`: patch review branch/repo setup, role execution ordering, review-path git state reporting.
- `v1/test/modes/patch/shrink.test.ts`: shrink-mode reset/rewrite behavior, commit body preservation, failure rollback semantics.
- `v1/test/modes/patch/subspec.test.ts`: active-subspec commit attribution and commit-message/body parsing over real git history.
- `v1/test/modes/plan/boundary.test.ts`: diff boundary selection across repo-history shapes.
- `v1/test/modes/plan/commits.test.ts`: plan-branch commit message/trailer/body rules, remote log expectations, trailer extraction.
- `v1/test/modes/plan/git-porcelain.test.ts`: porcelain status / repository-state helpers over real git output.
- `v1/test/modes/plan/pr.test.ts`: plan PR rendering, commit grouping, base/head selection, status/body expectations.
- `v1/test/modes/plan/review.test.ts`: plan review worktree creation, commit/review reporting, repository-state integration behavior.
- `v2/src/external-worktree.test.ts`: external worktree path/lock computation, lock busy/recover behavior, worktree creation/reuse, branch mismatch rejection.
- `v2/src/preload.test.ts`: v2-slice preload prepends the fake-agent bin dir; fake `codex --version` runs successfully through that preload.
- `v2/src/write-loop.test.ts`: resumable run creation, iteration recording, terminal/result mapping, blocker append on contract miss, budget soft-stop behavior.
- `v2/src/write.test.ts`: lock-scoped worktree execution, prompt/spec path resolution, artifact contract enforcement, step-result propagation.

## Redundancy / slow flags

- Duplicate coverage candidate: `shared/preload.test.ts` and `v2/src/preload.test.ts` assert the same preload contract in different slice roots; keep only if per-slice coverage is still needed.
- Duplicate coverage candidate: `test/test-slices.test.ts` re-asserts the preload contract by spawning the two preload assertion files.
- Slow: `v1/test/run.test.ts` uses real `sleep` and wall-clock elapsed assertions (`0.4s`, `1.4s`, `1.5s`, telemetry `setTimeout`).
- Slow: `v1/test/agents/spawn.test.ts` uses a background `sleep 120` process and polling.
- Slow: `v1/test/ready-script.test.ts` intentionally waits on a real timeout path (`sleep 2` with a 50ms deadline).
- Slow: `test/test-slices.test.ts` nests two `bun test` subprocesses and carries a `20_000` timeout.
- Slow: `v1/test/plan-command.test.ts` is the largest integration file in the corpus and should stay under review for merge/drop opportunities before adding more end-to-end cases.
