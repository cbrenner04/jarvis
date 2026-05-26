# 00 — Infer `targetDir` from intent path under `wip-intents`

## Problem

`jarvis1 plan <intent-file>` ignores the intent file's location when resolving `targetDir`. An intent at `v1/spec/wip-intents/foo.md` does not land specs under `v1/spec/` without `--target-dir v1/spec`. Paper-cut in repos where multiple spec trees coexist.

## Decisions

- New precedence: `--target-dir` > inferred-from-intent-path > `projects[<key>].plan.targetDir` > `modes.plan.targetDir` > `"spec"`.
- Inference triggers iff `inv.mode === "file"` AND `inv.targetDir === undefined`.
- Inline, interactive, `--resume`, `--resume-draft` bypass inference.
- Rule: intent abs path inside `project.root` AND has a `wip-intents` ancestor → inferred `targetDir` = project-relative path of `wip-intents`'s parent.
- Resolve intent with `path.resolve(inv.intentPath)`; no `realpathSync` — predictable across symlinked checkouts.
- Containment check: `relative(project.root, absIntent)` must not start with `..` and must not be absolute.
- `wip-intents` matched literally, case-sensitive.
- Multiple `wip-intents` ancestors → use deepest (last segment match).
- Empty inferred value (intent at `<root>/wip-intents/foo.md`) → skip, fall through. `targetDir = ""` would write at project root.
- Reuse `validateTargetDir()` from `v1/src/config.ts`; validation failure → silent fall through. Keep inference best-effort.
- Pure helper `inferTargetDirFromIntentPath(intentPath: string, projectRoot: string): string | undefined` in `v1/src/modes/plan/infer-target-dir.ts`.
- Wire-in at `v1/src/commands/plan.ts:663`: `const targetDir = inv.targetDir ?? inferredTargetDir ?? resolvedTargetDir;`.
- Success log via `planHarnessLog`: `plan: inferred targetDir=<value> from intent path`, emitted immediately before `plan: resolved flags ...`.
- Inference failure → no log line. Avoid noise on common non-`wip-intents` path.
- `modes.plan.commit: false` unaffected; downstream ignores `targetDir` when commit is false. No special-casing.
- No CLI flag or config key to disable inference; override is explicit `--target-dir`.
- Deferred to first consumer: debug-only "inference skipped: <reason>" log — pin when a user reports confusion.
- Deferred to first consumer: inferring when intent is under `<targetDir>/<existing-spec-dir>/intent.md` (resume-style inner-intent paths) — pin when a caller needs it.
- Backward compat: users with `projects[<key>].plan.targetDir` whose intents sit under `wip-intents/` see inferred value take precedence. Documented as migration note in `v1/docs/plan-mode.md`.

## Acceptance criteria

- [ ] `inferTargetDirFromIntentPath("<root>/v1/spec/wip-intents/x.md", "<root>")` returns `"v1/spec"`.
- [ ] `inferTargetDirFromIntentPath("<root>/v2/spec/wip-intents/x.md", "<root>")` returns `"v2/spec"`.
- [ ] `inferTargetDirFromIntentPath("/tmp/x.md", "<root>")` returns `undefined`.
- [ ] `inferTargetDirFromIntentPath("<root>/notes/x.md", "<root>")` returns `undefined`.
- [ ] `inferTargetDirFromIntentPath("<root>/wip-intents/x.md", "<root>")` returns `undefined`.
- [ ] `inferTargetDirFromIntentPath("<root>/v1/spec/WIP-Intents/x.md", "<root>")` returns `undefined`.
- [ ] Intent `<root>/v1/spec/wip-intents/x.md`, no `--target-dir`, no project override → spec dir under `<root>/v1/spec/...`.
- [ ] Intent `<root>/v2/spec/wip-intents/x.md` → spec dir under `<root>/v2/spec/...`.
- [ ] `--target-dir other/spec` wins over inference.
- [ ] Intent `/tmp/x.md` falls through to config default.
- [ ] Intent `<root>/notes/x.md` falls through to config default.
- [ ] `projects[<key>].plan.targetDir` bypassed when inference succeeds.
- [ ] `inv.mode === "inline"` bypasses inference.
- [ ] `--resume` bypasses inference.
- [ ] `--resume-draft` bypasses inference.
- [ ] On success, `plan: inferred targetDir=<value> from intent path` appears immediately before `plan: resolved flags ...`.
- [ ] On any inference failure, no inference log line appears.
- [ ] Inferred value failing `validateTargetDir()` → silent fall through; plan run continues.
- [ ] `v1/docs/plan-mode.md` documents inference rule, new precedence, backward-compat migration note.
- [ ] `v1/docs/config.md` `targetDir` section (~line 109) reflects new precedence.
- [ ] `README.md` plan-mode section reflects new precedence if it describes the chain.
- [ ] `bun run typecheck` passes.
- [ ] `bun test` passes.

## Documentation updates

- `v1/docs/plan-mode.md`: inference rule, updated precedence list, migration note.
- `v1/docs/config.md`: updated `targetDir` precedence chain.
- `README.md`: plan-mode `targetDir` precedence if described.
