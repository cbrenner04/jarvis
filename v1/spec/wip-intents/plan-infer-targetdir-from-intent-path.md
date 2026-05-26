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
