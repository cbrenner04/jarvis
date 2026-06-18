I'll verify the load-bearing claims against the actual code before issuing my verdict. The central disputes are about test fidelity (does the test exercise the production gate?) and doc accuracy (what do the adapters actually do with `additionalReadDirs`?).The test calls `runDraftPhase` directly and hand-feeds `additionalReadDirs`. The production gate at `plan.ts:870` (the `commit ? {} : {...}` spread) is what computes and forwards the dir — that's never exercised. Let me verify the producer call sites and whether a producer-level test seam exists.Confirmed: the production gate is at `plan.ts:870` and `:1114` (the `commit ? {} : {...}` spread). `planCommand` accepts `createAgent` (`resolveAgent` flows into both phases). Now let me verify a producer-level no-commit test pattern exists and confirm the adapter behavior for cursor/opencode/aider — the core of the doc-accuracy dispute.Decisive on doc accuracy: only `claude.ts`, `codex.ts`, and `aider.ts` reference `additionalReadDirs`. `cursor.ts` and `opencode.ts` have **zero** references — they never receive the dirs at all. Let me confirm the exact adapter behavior and find the existing no-commit producer test.Confirmed precisely:
- claude: `--add-dir <dir>` (honors)
- codex: `--add-dir <dir>` (honors)
- aider: bare positional `argv.push(dir)` — NOT `--add-dir`
- cursor/opencode: zero references — never receive the dir at all

The `plan-mode.md` text saying "Cursor, Opencode, Aider … Accept the `--add-dir` flag but do not honor write grants" is factually wrong twice. Let me verify the existing no-commit producer test pattern and read the doc text being critiqued.This is decisive and authoritative. The repo's own `v1/docs/AGENTS.md` confirms:
- claude/codex: `--add-dir <path>` for "external spec directory"
- cursor/opencode: siblings "listed in the prompt" (no `--add-dir`)
- aider: "positional argument"

So `plan-mode.md:434` claiming cursor/opencode/aider "Accept the `--add-dir` flag" is factually wrong AND contradicts `AGENTS.md`. Also note `plan-mode.md:430` has a typo: "effectivness".

The `plan-no-commit-intent-output.test.ts` confirms the producer-level pattern: register a project, set `plan = { commit: false }`, write a ready-intent, call `planCommand` directly. Combined with `createAgent` injection (`PlanCommandOptions.createAgent`), a producer-level test is fully feasible with existing infrastructure.

I have verified all load-bearing claims. Let me confirm the `createAgent` seam type and the `v1-behaviors.md` line wording.All claims verified. `planCommand` accepts `createAgent` (line 61), flowing through `resolveAgent` (line 527) into both the draft (line 876) and review (line 1123) phases. The `v1-behaviors.md` line says cursor/opencode "accept and ignore the directory" — closer to correct but "accept … the directory" still implies they receive it (they don't), and it omits aider while `plan-mode.md` names it, leaving the two docs inconsistent.

I have everything needed to issue the verdict.

---

# Verdict — `2026-06-18T16-47-07Z-no-commit-plan-external-spec-write-access`

The design is sound and approved as previously adjudicated: reuse patch-mode's `additionalReadDirs` → `--add-dir` vector, gate on `commit === false`, wire draft/review/verdict-actuator, exclude resume. The wiring in `plan.ts`, `draft.ts`, `review.ts`, `verdict-actuator.ts`, and `run.ts` is correct and complete. No design or wiring rework is required. However, the implementation **fails two acceptance criteria as worded** and ships **factually incorrect documentation that contradicts the repo's own reference docs**. The following outcomes are required.

## Required outcomes

### 1. The no-commit regression test must drive the production call path. (Blocking.)

AC#1 explicitly requires a test "that drives the production call path (it does not pass the spec dir as the agent's working directory)." The shipped test (`v1/test/plan-draft-additional-read-dirs.test.ts`) calls `runDraftPhase` directly and **hand-feeds** `additionalReadDirs: [externalSpecDir]` as an input. The actual fix — the `commit ? {} : { …, additionalReadDirs: [finalSpecPath] }` construction in `v1/src/commands/plan.ts` (the draft site at line 870 and the review site at line 1114) — has **zero test coverage**. A regression that inverts the gate, drops the spread, or wires the wrong directory would pass every existing test. The test asserts its own input, not the production behavior.

Required: a regression test must exercise the real `commit`-gated forwarding by driving `planCommand` end-to-end in `commit: false` mode (not by calling `runDraftPhase` with a pre-supplied `additionalReadDirs`), and assert that the captured `agent.run` options carry the external spec dir in `additionalReadDirs`. This is achievable with existing infrastructure: `planCommand` accepts a `createAgent` injection seam, and `v1/test/plan-no-commit-intent-output.test.ts` already demonstrates driving `planCommand` end-to-end in no-commit mode (register a project, set `plan = { commit: false }`, write a ready-intent, call `planCommand`). No new production seam is needed.

Rationale: an acceptance criterion that promises to drive the production path is not satisfied by a test that bypasses it. A gate with no coverage is exactly where the inversion-regression the spec warns about will hide.

### 2. The `commit: true` non-leak and patch-review-unset guarantees must be exercised, not inspected. (Blocking.)

AC#5 requires that under `commit: true`, all three phases invoke `agent.run` with no plan-spec directory in `additionalReadDirs`, and AC#6 requires that patch review leaves the shared runner's `additionalReadDirs` unset. The shared review runner (`v1/src/modes/review/run.ts`) is genuinely multi-caller (plan review and patch review). The current implementation proves AC#3/#4/#5/#6 for the review and actuator phases only by visual inspection of the diff; no executed test asserts the captured options for those phases in either `commit` mode.

Required: the producer-level test from outcome #1 must additionally assert that under `commit: false` the review and verdict-actuator phases' captured `agent.run` options carry the external spec dir (closing AC#3/#4), and that under `commit: true` all three phases' captured options carry no plan-spec directory (closing AC#5). Add one assertion that a patch-mode review run leaves the shared runner's `additionalReadDirs` unset (closing AC#6). All three phases share the one injected fake agent in a single `planCommand` run, so this is incremental, not a redesign.

Rationale: "unchanged" and "not widened" must be proven on a shared path, precisely because an untested optional field on a multi-caller runner is where a leak would land undetected.

### 3. Correct the `plan-mode.md` per-agent claim — it is factually wrong and contradicts `AGENTS.md`. (Blocking, doc accuracy.)

`v1/docs/plan-mode.md` states that "Cursor, Opencode, Aider … Accept the `--add-dir` flag but do not honor write grants." This is incorrect on the mechanics and contradicts the repo's own `v1/docs/AGENTS.md`:

- **cursor** and **opencode** never reference `additionalReadDirs` at all — the directory is never placed on argv and never reaches the CLI. `AGENTS.md` states siblings/external dirs are "listed in the prompt" for these agents, not passed as `--add-dir`.
- **aider** does consume `additionalReadDirs`, but pushes each as a **bare positional argument**, not `--add-dir`. `AGENTS.md` states aider receives them as a "positional argument."
- Only **claude** and **codex** emit `--add-dir <dir>`.

Required: the documentation must accurately state that only claude and codex receive the external spec dir as `--add-dir` (write-effective), cursor and opencode never receive the dir, and aider receives it as a positional argument — consistent with `v1/docs/AGENTS.md`. The verdict's prior refinement asked only for a one-line accuracy note recording the claude/codex-only write semantics; the implementation over-elaborated into a four-bullet section that introduced the factual error. Tightening it to a correct, terse statement satisfies both accuracy and the repo's terseness discipline. Also fix the typo "effectivness" → "effectiveness" if the section is retained.

Rationale: docs that misstate runtime behavior and contradict the authoritative `AGENTS.md` are worse than no docs — an operator with a non-default `modes.plan.agentOrder` would be misled about why their no-commit plan silently fails to write.

### 4. Reconcile `v1-behaviors.md` with the corrected `plan-mode.md`. (Should-fix, doc accuracy.)

`v2/docs/v1-behaviors.md` says cursor/opencode "accept and ignore the directory," which still implies they receive the directory (they do not), and it omits aider while `plan-mode.md` names it — leaving the two docs mutually inconsistent.

Required: align `v1-behaviors.md` with the corrected `plan-mode.md` so both state that cursor/opencode never receive the dir and, if aider is mentioned, that it receives the dir positionally. Keep it terse — a single line plus caveat is sufficient.

Rationale: two durable docs describing the same behavior must not disagree; the documentation standard requires the durable home to be accurate, and inconsistency forces readers to guess which is right.

## Out of scope (confirmed; no action)

- Making cursor/opencode honor `--add-dir` writes — explicitly excluded by the intent and subspec as an inherited limitation of the patch-mode prerequisite. Correctly not attempted; do not expand scope to address it.
- The blocker-path append being inspected by nothing in `runDraftPhase` (validation runs in the producer) — AC#2 was deliberately narrowed to claim only that the dir reached `agent.run` on the blocker path. The producer-level test from outcome #1 naturally routes the blocker path through `validateDraftOutput`, strengthening it for free, but no separate work is owed.
- Changing default `modes.plan.commit`, reworking v2 intent flow, or broad sandbox policy.

Net: approve the design and wiring; require the actuator to (1) replace the input-asserting draft test with a `planCommand`-driven no-commit test that exercises the real gate and asserts `additionalReadDirs` reaches `agent.run`, (2) extend it to cover the review/actuator phases and the `commit: true` and patch-review-unset guarantees, and (3–4) correct and reconcile the per-agent documentation to match `v1/docs/AGENTS.md`. No scope expansion required; all outcomes reuse existing infrastructure.