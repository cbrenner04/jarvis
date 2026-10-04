Reviewing the spec draft structure and key code paths to ground the verdict.
## Verdict: refinements required before merge

### 1. Repair spec routing and subspec boundaries

The index must list every subspec in intent order and link each file exactly once. The draft currently routes only two of four files and splits write-loop work across misnamed, near-duplicate subspecs (`01-daemon.md` / `02-execution-loop.md`) while orphaning preflight and daemon-projection slices.

**Required outcome:** Realign to intent’s three module-boundary subspecs — preflight gates → write-loop settlements → daemon list/wait projection — with a single problem statement, decision ledger, task checklist, acceptance criteria, and documentation section per subspec. Every intent task and acceptance outcome must appear exactly once across the final subspecs; nothing dropped, nothing duplicated.

### 2. Fix broken cross-references

Prerequisite links point at `./01-write-loop-settlements.md`, which does not exist.

**Required outcome:** All inter-subspec links and index entries must resolve to real files after renumbering.

### 3. Make the stale-dirty preflight AC genuinely red against baseline

The runbook documents run `eabc39a7` as a worktree that was **neither retired nor refused** (HEAD behind `--base`, dirty, then false `completed`). An existing workflow test already refuses dirty worktrees on implement re-run, so a naive “HEAD behind + dirty → names paths” AC may be green today and violates the failing-test requirement for runtime-behavior subspecs.

**Required outcome:** The preflight AC must target the actual pre-fix gap — either the documented “neither retired nor refused” reuse path, or a fixture that isolates the new descendant/stale-reuse refusal from the existing dirty gate (e.g., via `--reset-despite-dirty` where appropriate). The AC must state observable refusal semantics and assert it fails against current code.

### 4. Pin full preflight gate ordering and override scope

Intent fixes preserve-before-dirty for retirement gates and adds a separate descendant check for re-run reuse, but the draft does not order descendant relative to preserve/dirty or bound override flags.

**Required outcome:** The preflight decision ledger must state an explicit gate sequence (descendant re-run refusal → preserve landed criteria → dirty reuse → retirement) and require combined stderr naming when multiple conditions apply. Decision lines must clarify that `--reset-despite-dirty` bypasses only the dirty gate, `--reset-despite-landed-criteria` bypasses only the preserve gate, and neither overrides the descendant check.

### 5. Target the real dirty-`no-work` bypass in write-loop ACs

A dirty guard already runs on the `published.commitSha === undefined` completion path; the `publishCompletion === false` short-circuit can still emit `loopOutcomeKind: "complete"` without that check.

**Required outcome:** The dirty-`no-work` acceptance criterion must name a fixture that exercises the bypass path (or another genuinely red baseline) and asserts non-`completed` settlement with uncommitted paths in durable output. The linked `@mutate` directive must use a repo-relative path (`v2/src/execution/write-loop.ts`) per spec guidance.

### 6. Complete resumable-timeout acceptance coverage

Intent requires completion inventory on **all** `iteration_timeout` terminal records and resume retention without stale reset. The draft pins inventory and predicate inversion only on the resumable case; resume integration lives in a misnamed daemon subspec.

**Required outcome:** After subspec collapse, `01` must own: dirty-`no-work` settlement; resumable vs non-resumable `iteration_timeout` (`resumable` on durable `loop_finished`; `nextAction` deferred to projection); completion inventory on both timeout cases; resume integration proving retained branch/worktree, no `resetStaleWorkspace`/rematerialization, and pre-timeout commits still reachable. State explicitly that preflight (`00`) is primary defense against drifted reuse and write-loop settlement is backstop.

### 7. Close daemon-projection gaps

The projection subspec is drafted but unrouted. Recovery copy for `iteration_timeout` still says “re-dispatch the workflow” in code; intent replaces that for completed-subspec timeouts.

**Required outcome:** The final projection subspec must carry list/wait ACs for dirty-`no-work` refusal, both timeout resumability cases, completion inventory (including coexistence with `publicationFailure`), and an AC or behavior-preserving citation pinning updated `RUN_OPERATOR_ERROR_RECOVERY` copy for resumable timeout. It must own `daemon-host.md` updates. The closing acceptance criterion must include the full intent gate suite (`typecheck`, `check`, `lint:md`, `test:v2`, `test:integration:v2`).

### 8. Preserve mutation-checkpoint contract

Intent requires four `@mutate` checkpoints (descendant, preserve, dirty-`no-work`, completed-subspec resumability). No separate stale-dirty mutation is needed if descendant + preserve cover reuse — but each checkpoint AC must remain a single-line criterion with pinning-test file, verbatim test name, and a valid linked directive.

**Required outcome:** After restructuring, all four checkpoints must remain assigned to the correct owning subspec with unambiguous file paths and directives that invert exactly one guard each.

### Rationale

Structural defects block Jarvis routing and violate atomic-subspec guidance. Failing-test and mutation-checkpoint rules require ACs that are red pre-fix and green only after the intended guard — several draft ACs may already pass. Intent’s ordered three-slice model and coupled preflight precedence are sound; the draft’s fragmentation and fixture imprecision are what must be corrected, not the behavioral design.