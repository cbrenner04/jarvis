## Verdict — refinements required

### 1. Correct the problem framing: attach is already right on `main`

`v2/src/commands/workflow.ts` already prints the admitted run ID and issues exactly one `waitForRunCompletion` against that **entry** run ID, and the daemon's entry `wait` already awaits workflow rollup (`v2/docs/workflow-runner.md` § "Workflow run id status"). The spec's own Prerequisites say as much, but its Problem paragraph reads as if attached exit semantics are broken.

The spec must state the real gap: the *attach contract is unguarded and mis-documented*, not defective. Concretely — `workflow.test.ts` mocks a single `wait` frame so an early-exit client would still pass, and `v2/docs/operator-runbook.md` (Known gotchas, ~line 906) still asserts attach "returns on its *first* constituent run." Honest framing matters because it determines what the attach work actually is (regression + doc truth) and prevents an implementer from "fixing" already-correct CLI code.

### 2. Split the subspec; keep both halves linked from the index

Two independently testable seams are bundled today:

- **Detach:** flag parsing/usage across presets, the post-admission branch, the detach IPC regression, the detach-continuation fixture, and detach docs. Net-new behavior, fails pre-fix.
- **Attach contract:** the multi-row real-subprocess regression against a staged daemon fixture plus the runbook/doc correction. Ships and verifies without the flag existing.

The attach half carries the heavy new fixture surface; bundling it means a fixture problem blocks the operator-facing behavior the intent actually asks for. Split into two subspecs, both linked from `index.md`, with every existing task and acceptance outcome carried across exactly once — no dropped coverage, no compression. Both remain in one spec/PR, satisfying the intent's "pin attach in the same change."

### 3. Classify the attach criteria correctly

Only the detach criteria fail against pre-fix code. The attach criteria are regression/contract coverage over behavior that already holds, and per repo spec guidance preservation criteria must be written as citations of the pinning test/source rather than paraphrases of assumed behavior. Restate them so the contract is: the new multi-row test *pins* entry-terminal wait, and its pre-fix failure story is **mutation**, not baseline — it must fail when client `wait` is omitted or retargeted at a constituent run ID. State that explicitly so a reviewer does not read it as a false "fails against `main`" claim. The subspec's guard-inversion criterion must name which inversion fails which test on both sides (detach guard inverted → detach IPC test fails; `wait` omitted/retargeted → attached test fails).

### 4. Make the attached test's observation contract non-racy

"Asserts the process has not exited while a second constituent row is still non-terminal" names the outcome but not how liveness is observed. Since the entry `wait` blocks until rollup, an unstaged fixture yields either a flaky or a vacuous assertion. The spec must require a fixture that can hold the workflow at a deterministic mid-state (second constituent non-terminal, entry non-terminal) and an observation point that is deterministic rather than timing-based — without mandating a specific helper or API.

### 5. Fix the "exactly one `start` IPC" wording

Launch runs a stale-workspace reset through a wrapped daemon client before `start`, so a total-frame count is the wrong invariant and will either force test contortions or silently disable reset. The criterion must assert **no client `wait` after admission**, leaving preflight/reset RPCs unconstrained.

### 6. Close the detach flag-surface gaps

The spec asserts "every registered preset" but grades only implement. It must cover, as criteria or explicit decisions: `--detach` accepted on all presets **and** their reviewed/legacy aliases; usage/help strings updated for each; failed admission behavior unchanged **with `--detach` on argv** (today's preservation test only exercises the attach form); and detach preserving the pre-ID stderr the attach path emits (intent paths line) ahead of the run ID.

### 7. Prerequisites must be visible where the implementer reads

Implement agents read the active subspec, not `intent.md`. Carry the two prerequisites (entry run ID printed on admission; daemon rollup on entry `wait`/`list`) into the subspec(s), so attach is not misread as requiring a daemon or CLI behavioral fix.

### 8. Tighten documentation scope

- Narrow the broad "operator docs" claim to the specific stale artifact: the runbook Known-gotchas bullet. Correcting/removing it is a named deliverable, not a general docs sweep.
- `v2/docs/write-behavior.md` additions are additive (new detach/attach launch modes, per-mode stdout, "exit `0` on attach means the workflow finished"); include the run-control surface listing `--detach` so the flag is discoverable, not only prose.
- Decide `v2/docs/workflow-runner.md` explicitly: its "first step's run id" line is accurate for the daemon-internal function and the rollup is documented immediately after, so either scope a wording alignment to "entry run id" or declare it out of scope with that rationale — don't leave it unaddressed.
- The runbook must state that detach exit `0` means *admitted*, not *succeeded*, and point at the admission run ID as the observation handle.

### 9. Record that this supersedes the prior no-detach decision

Earlier landed specs explicitly ruled out `--detach` and deferred it. One line noting this intent supersedes that decision sets reviewer expectations and stops the flag reading as scope creep.