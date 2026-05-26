# 00 — Infer `targetDir` from intent path under `wip-intents`

## Problem

`jarvis1 plan <intent-file>` ignores the intent file's location when resolving `targetDir`. An intent at `v1/spec/wip-intents/foo.md` does not cause the generated spec to land under `v1/spec/`; the user must remember `--target-dir v1/spec`. This is a paper-cut in repos like jarvis where v1 and v2 spec trees coexist.

## Decisions

- Add inferred layer between `--target-dir` flag and `projects[<key>].plan.targetDir` in precedence.
- New precedence: `--target-dir` > inferred-from-intent-path > `projects[<key>].plan.targetDir` > `modes.plan.targetDir` > `"spec"`.
- Inference triggers only when `inv.mode === "file"` AND `inv.targetDir === undefined`.
- Inline, interactive, `--resume`, and `--resume-draft` invocations bypass inference entirely.
- Inference rule: if intent absolute path is inside `project.root` AND has a `wip-intents` ancestor, inferred `targetDir` is the project-relative path of `wip-intents`'s parent.
- Resolve intent path with `path.resolve(inv.intentPath)`; do not call `realpathSync` — preserve predictable semantics across symlinked checkouts.
- Containment: `relative(project.root, absIntent)` must not start with `..` and must not be absolute.
- Match `wip-intents` literally (case-sensitive); do not match `WIP-Intents` or variants.
- When multiple `wip-intents` ancestors exist (unlikely), use the deepest (last segment match).
- Empty inferred value (intent at `<root>/wip-intents/foo.md`) is invalid — skip inference, fall through. Rationale: `targetDir = ""` would write specs at project root.
- Reuse `validateTargetDir()` from `v1/src/config.ts` on inferred value; validation failure is silent inference failure (log nothing, fall through). Rationale: keep inference best-effort, never abort a plan run on it.
- Implement as pure helper `inferTargetDirFromIntentPath(intentPath: string, projectRoot: string): string | undefined` in `v1/src/modes/plan/infer-target-dir.ts`. Rationale: testable without spinning up full plan invocations.
- Wire-in at `v1/src/commands/plan.ts:663`: `const targetDir = inv.targetDir ?? inferredTargetDir ?? resolvedTargetDir;`.
- On successful inference, emit `plan: inferred targetDir=<value> from intent path` via `planHarnessLog`, immediately before the existing `plan: resolved flags ...` line so the resolved value reflects inference.
- On inference failure (any cause), emit no log line. Rationale: avoid noise on the common non-`wip-intents` path.
- `modes.plan.commit: false` (external specs) is unaffected by inference logic itself; downstream code ignores `targetDir` when commit is false. No special-casing needed.
- No new CLI flag or config key to disable inference. Override path is explicit `--target-dir`.
- Deferred to first consumer: debug-only "inference skipped: <reason>" log — pin when a user reports confusion.
- Deferred to first consumer: inferring when intent is under `<targetDir>/<existing-spec-dir>/intent.md` (resume-style re-runs passing inner intent path) — pin when a caller needs it.
- Backward compatibility: users relying on `projects[<key>].plan.targetDir` whose intents happen to sit under `wip-intents/` will see inferred value take precedence. Acceptable: inferred value matches dominant convention; explicit `--target-dir` still wins. Documented as migration note in `v1/docs/plan-mode.md`.

## Tasks

- Create `v1/src/modes/plan/infer-target-dir.ts` exporting `inferTargetDirFromIntentPath(intentPath, projectRoot): string | undefined`.
- Co-locate unit tests at `v1/src/modes/plan/infer-target-dir.test.ts`.
- In `v1/src/commands/plan.ts`, compute `inferredTargetDir` after `project` is resolved and `inv` is known; insert into the `targetDir` resolution at line ~663. Only call helper when `inv.mode === "file"` and `inv.targetDir === undefined`.
- Emit success log line via `planHarnessLog` immediately before the `plan: resolved flags ...` line.
- Add integration test through `runPlan`-level entry asserting (a) `plan: inferred targetDir=<value> from intent path` log appears, (b) spec dir lands at inferred path. Use existing plan-mode test scaffolding.
- Update `v1/docs/plan-mode.md`: document inference rule, updated precedence, migration note for users with `projects[<key>].plan.targetDir` overrides.
- Update `v1/docs/config.md` `targetDir` section (~line 109): document new precedence chain including inferred layer.
- Update `README.md` plan-mode section if it describes `targetDir` precedence.

## Acceptance criteria

- [ ] `inferTargetDirFromIntentPath("<root>/v1/spec/wip-intents/x.md", "<root>")` returns `"v1/spec"`.
- [ ] `inferTargetDirFromIntentPath("<root>/v2/spec/wip-intents/x.md", "<root>")` returns `"v2/spec"`.
- [ ] `inferTargetDirFromIntentPath("/tmp/x.md", "<root>")` returns `undefined` (outside project root).
- [ ] `inferTargetDirFromIntentPath("<root>/notes/x.md", "<root>")` returns `undefined` (no `wip-intents` ancestor).
- [ ] `inferTargetDirFromIntentPath("<root>/wip-intents/x.md", "<root>")` returns `undefined` (empty inferred targetDir).
- [ ] `inferTargetDirFromIntentPath("<root>/v1/spec/WIP-Intents/x.md", "<root>")` returns `undefined` (case-sensitive).
- [ ] When intent path is `<root>/v1/spec/wip-intents/x.md`, no `--target-dir`, no project override: spec dir lands under `<root>/v1/spec/...`.
- [ ] When intent path is `<root>/v2/spec/wip-intents/x.md`: spec dir lands under `<root>/v2/spec/...`.
- [ ] Explicit `--target-dir other/spec` wins over inference (spec lands under `<root>/other/spec/...`).
- [ ] Intent at `/tmp/x.md` falls through to config default `targetDir`.
- [ ] Intent at `<root>/notes/x.md` falls through to config default `targetDir`.
- [ ] `projects[<key>].plan.targetDir` override is bypassed when inference succeeds.
- [ ] `inv.mode === "inline"` bypasses inference (uses configured/flag `targetDir` only).
- [ ] `--resume` invocation bypasses inference.
- [ ] `--resume-draft` invocation bypasses inference.
- [ ] On successful inference, `plan: inferred targetDir=<value> from intent path` appears in plan harness log immediately before `plan: resolved flags ...`.
- [ ] On inference failure (any reason), no inference-related log line appears.
- [ ] If inferred value fails `validateTargetDir()`, inference silently fails and plan run continues using next precedence layer.
- [ ] `v1/docs/plan-mode.md` documents the inference rule, new precedence chain, and backward-compat migration note.
- [ ] `v1/docs/config.md` `targetDir` section reflects new precedence chain.
- [ ] `README.md` plan-mode section, if it describes `targetDir` precedence, reflects the new chain.
- [ ] `bun run typecheck` passes.
- [ ] `bun test` passes.

## Documentation updates

- `v1/docs/plan-mode.md`: add inference rule, update precedence list, add migration note for project-override users.
- `v1/docs/config.md`: update `targetDir` precedence chain (~line 109).
- `README.md`: update plan-mode `targetDir` precedence if described.
