# 00 — Restraint principles artifact + write-step injection

The single canonical copy of the v2 architectural-restraint principles, plus
wiring that injects them into the v2 write-step prompt each iteration. Few +
sharp so they survive prompt pressure. This is the only one of the three
intent surfaces (executor / plan / review) wired now; plan and review have no
v2 consumer yet (deferred below).

## Principle set (the canonical content)

The artifact body holds these seven, terse, in this order:

1. Separate decision from effect — compute a typed outcome, perform side
   effects in a separate handler keyed off it; no branch both decides and enacts.
2. No abstraction until two real callers — inline first; extract on the second.
3. Extend before you create — a new file needs a distinct responsibility, not
   just length.
4. No speculative configuration — no flags/knobs/options nobody asked for.
5. One module, one responsibility — exports share one reason to change.
6. Data over branches — replace input→output if/else ladders with table/dispatch.
7. Stay in scope — change only what the active task names; no drive-by refactors.

## Decisions

- Canonical text lives in exactly one registered prompt artifact under
  `prompts/` (mirrors `prompts/patch/rules.md`); v2/docs and any later
  plan/review citation point at it, never copy it. Rules out the drift failure
  the intent forbids: hand-maintained copies in prompt + docs.
- Inject the artifact body into the rendered write prompt via the step-owned
  injected-body path (v1 `patch.rules` pattern: `STEP_RULES` placeholder or a
  dedicated placeholder fed from the registry), not by switching the write
  prompt to `assemblePromptForStep`. Rules out the global/behavior-assembly
  alternative, which would also pull `global.*` fragments into the write prompt
  — an out-of-scope behavior change.
- Artifact is write-scoped, not a `behavior: global` fragment. Rules out
  leaking v2 restraint principles into v1 patch/plan prompts, breaking the
  stated v2-only scope.
- The v2/docs reference page is a thin pointer to the artifact, not a second
  copy of the principle text. Rules out a third divergent copy.

Deferred to first consumer: cite the principle artifact from the plan/review
prompts — pin when a v2 plan mode / review phase exists. (No v2 plan or review
consumer exists today; building wiring against absent consumers is the
invent-precision failure this intent forbids, and editing v1's live
plan/review prompts breaks v2-only scope.)

## Task checklist

- [ ] Add the principle artifact (registered prompt with stable id, e.g.
  `write.principles`) holding the seven principles; add its line to
  `prompts/registry.txt`.
- [ ] Wire the artifact body into the rendered write-execute prompt so it
  renders every write iteration.
- [ ] Test: the rendered write prompt contains principle text (assert a stable
  marker phrase from each principle, or at minimum a distinct phrase proving
  all seven render).
- [ ] Add `v2/docs/coding-standards.md` as the durable v2 reference, pointing
  at the canonical artifact as the sole source of the principle text.
- [ ] Update `v2/docs/write-behavior.md` (and the prompts.md layering
  inventory) to note the write prompt now injects the principle artifact.

## Acceptance criteria

- [x] The seven restraint principles exist as one registered prompt artifact
  loadable by id through the shared registry; `prompts/registry.txt` lists it.
- [x] `renderWriteExecutePrompt` output contains the principle text; a test in
  `v2/src/` asserts every principle renders (distinct phrase per principle).
- [x] No second copy of the principle text exists: `v2/docs/coding-standards.md`
  points at the artifact rather than restating the principles.
- [x] `v2/docs/write-behavior.md` and `v2/docs/prompts.md` reflect the injected
  principle artifact.
- [x] `bun run typecheck` and `bun test` pass.

## Documentation updates

- New `v2/docs/coding-standards.md`: v2 restraint-principles reference; points
  at the canonical prompt artifact.
- `v2/docs/write-behavior.md`: note principle injection into the write prompt.
- `v2/docs/prompts.md`: add the artifact to the layering inventory.
- `v2/docs/v1-behaviors.md`: no change — additive v2-only; no v1 behavior changes.
