---
name: infer-target-dir-from-intent-path
---
# Infer `targetDir` from intent file path in `jarvis1 plan`

## Problem

`jarvis1 plan <intent-file>` reads the intent file as text but does not use its location to inform where the resulting spec is written. The output spec dir is `<projectRoot>/<targetDir>/<specDirBasename>/`, where `targetDir` resolves via:

`--target-dir` flag > `projects[<key>].plan.targetDir` > `modes.plan.targetDir` > `"spec"` (v1/docs/config.md:109)

This means an intent located at `v1/spec/wip-intents/foo.md` does **not** cause the generated spec to land under `v1/spec/`. If the config default is `spec/` (or wrong for the repo), the user must remember to pass `--target-dir v1/spec` even though the intent path already implies the right location. This is a UX paper-cut, especially in repos like jarvis where v1 and v2 spec trees coexist.

## Desired behavior

When `jarvis1 plan` is invoked with an intent file path (not inline text, not `--resume`), and the user has not passed `--target-dir`, jarvis should attempt to infer `targetDir` from the intent file's location:

1. Resolve the intent file path to an absolute path.
2. If the intent file is inside the resolved project root AND is under a directory named `wip-intents`, take the parent of `wip-intents` (relative to project root) as the inferred `targetDir`. Example: `<root>/v1/spec/wip-intents/foo.md` → `targetDir = "v1/spec"`.
3. If inference succeeds, use the inferred value and log it: `plan: inferred targetDir=v1/spec from intent path`.
4. If inference fails (intent outside project root, not under `wip-intents`, etc.), fall back to the existing precedence chain.

Precedence becomes: `--target-dir` flag > inferred-from-intent-path > `projects[<key>].plan.targetDir` > `modes.plan.targetDir` > `"spec"`.

## Scope notes

- Only applies to file-based intents. Inline text and `--resume` / `--resume-draft` invocations are unaffected.
- Only the `wip-intents/<parent>` convention is inferred — do not try to be clever with arbitrary nesting. Keeps the rule predictable.
- Explicit `--target-dir` always wins so users can override inference.
- Intent files outside the project root (e.g. `/tmp/foo.md`) skip inference silently and fall through.
- Log the inference decision (or non-decision) at the same verbosity level as the existing `plan: resolved flags ...` line so users can see what happened.

## Acceptance hints (for the implementer)

- Unit test: intent at `<root>/v1/spec/wip-intents/x.md`, no `--target-dir`, no project override → uses `v1/spec`.
- Unit test: intent at `<root>/v2/spec/wip-intents/x.md` → uses `v2/spec`.
- Unit test: explicit `--target-dir other/spec` wins over inference.
- Unit test: intent at `/tmp/x.md` → falls through to config default.
- Unit test: intent at `<root>/notes/x.md` (no `wip-intents` ancestor) → falls through.
- Unit test: project override is bypassed when inference succeeds (inference sits above project override in precedence).
- Update `v1/docs/plan-mode.md` and `v1/docs/config.md` to document the inference rule and updated precedence.
- Update `README.md` plan-mode section if precedence is described there.

## Out of scope

- Inferring `targetDir` from anything other than a `wip-intents/` parent (e.g. heuristics based on file content, project conventions, sibling files).
- Changing where `jarvis1 run` writes things.
- Removing or renaming the existing `--target-dir` flag.
- Creating `wip-intents/` automatically if missing.

## Refinement

- Inference site: `v1/src/commands/plan.ts` around line 663 where `targetDir = inv.targetDir ?? resolvedTargetDir`; insert an inferred layer between them — only consulted when `inv.targetDir` is undefined.
- Trigger condition: `inv.mode === "file"` AND `inv.targetDir === undefined`; all other modes (`inline`, `interactive`, resume variants) bypass inference entirely.
- Resume bypass applies to both `--resume` (review/refine resume) and `--resume-draft`; neither re-evaluates `targetDir` from intent path since the spec dir already exists.
- Path resolution: use `path.resolve(inv.intentPath)` (cwd-relative) before comparing against `project.root`; do not follow symlinks (no `realpathSync`) — keep semantics predictable across symlinked checkouts.
- Containment check: `relative(project.root, absIntent)` must not start with `..` and must not be absolute; reject if either holds.
- `wip-intents` match: split the project-relative path on `/` (posix separators after `relative()` normalization) and find the last segment literally equal to `wip-intents`; the inferred `targetDir` is everything before it joined back with `/`. Use the last match, not the first, so nested `wip-intents` (unlikely) prefers the deepest.
- Empty inferred targetDir (intent at `<root>/wip-intents/foo.md`) is invalid; skip inference and fall through with a log line — `targetDir = ""` would write specs at the project root.
- Reuse `validateTargetDir()` from `v1/src/config.ts` on the inferred value; if validation throws, treat as inference failure (log and fall through) rather than aborting the plan run — keeps inference best-effort.
- Log messages use existing `planHarnessLog` channel, emitted immediately before the `plan: resolved flags ...` line so the resolved value reflects inference: success `plan: inferred targetDir=<value> from intent path`; failure cases produce no log (silent fallthrough) to avoid noise on the common non-`wip-intents` path. Deferred to first consumer: whether to add a debug-only "inference skipped: <reason>" log — pin when a user reports confusion.
- Case sensitivity: literal `wip-intents` only; do not match `WIP-Intents` or similar. Matches existing convention in `v1/spec/wip-intents/` and inline-intent write path at `plan.ts:680`.
- Precedence interaction with `modes.plan.commit: false` (external specs in `~/.jarvis/specs/...`): inference still runs and still sets `targetDir`, but `targetDir` is ignored downstream when commit is false (specs land in `~/.jarvis/specs/<project>/...`); no behavior change for no-commit, no special-casing in inference code.
- No new CLI flag to disable inference; users override by passing `--target-dir` explicitly. A blanket disable is YAGNI until requested.
- No config key to disable inference (e.g. `modes.plan.inferTargetDir`); same rationale.
- Test seam: extract inference into a pure helper `inferTargetDirFromIntentPath(intentPath: string, projectRoot: string): string | undefined` so unit tests do not need to spin up full plan invocations. Export from a small module (e.g. `v1/src/modes/plan/infer-target-dir.ts`) and co-locate the unit test.
- Integration coverage: at least one test through `runPlan`-level entry that asserts the `plan: inferred targetDir=...` log line appears and the spec dir lands at the inferred path; existing plan-mode test scaffolding patterns apply.
- Docs: update `v1/docs/plan-mode.md` precedence list, `v1/docs/config.md` `targetDir` section (line ~109), and the plan-mode portion of `README.md`. Keep prose terse — bullet-list the new precedence and a one-line inference rule.
- Spec guidance (`v1/docs/spec-guidance.md`) does not need updating — it describes spec layout, not flag precedence.
- Backward compatibility: users who currently rely on the project/global `plan.targetDir` override but happen to place intents under `wip-intents/` will see a behavior change. Acceptable because (a) the inferred value matches the most common intent-placement convention and (b) explicit `--target-dir` still wins. Call this out in `v1/docs/plan-mode.md` migration note.
- Deferred to first consumer: whether to also infer when intent is under `<targetDir>/<existing-spec-dir>/intent.md` (e.g. resume-style re-runs that pass an inner intent path) — pin when a caller needs it.

## Refine skip

Prior refinement turn captured inference site, trigger, resume bypass, path resolution, containment, match rule, empty-result handling, validation reuse, logging channel, case sensitivity, no-commit interaction, no disable flag/config, test seam, integration coverage, docs scope, backward-compat note, and two explicit deferrals. No net-new decisions surfaced from re-reading `plan.ts` (inferred value flows transparently through downstream `targetDir` consumers) or `config.ts` (`validateTargetDir` is exported at line 656, reusable as planned).
