# intent --target-dir override

## Problem

`jarvis intent` resolves a single `targetDir` from `resolvePlanFlags` (project/global `plan.targetDir`, else `"spec"`) with no per-run override — it accepts only `--repo`/`--cwd`. `jarvis plan` already accepts a validated `--target-dir`. With one project default, intent cannot author v1 vs v2 seeds/ready-intents into different trees, so the route-by-target layout requires editing config between runs. Add the override to intent, mirroring plan.

## Decisions

- Reuse `validateTargetDir` and plan's precedence (flag > project `plan.targetDir` > global > `"spec"`); do not invent a second validation path. — rules out a divergent intent-only validator.
- `--target-dir` governs the seed-input location check (`<dir>/wip-intents/`), committed ready-intent output (`<dir>/ready-intents/`), and the printed next-steps path. — rules out applying it to only one of the three and silently misrouting the others.
- No-commit external output stays flat at `~/.jarvis/specs/<id>/ready-intents/` (targetDir was never applied there); the flag only moves the seed-input check in that mode. — rules out inventing a targetDir-nested external layout no caller asked for.

## Task checklist

- [ ] Add `--target-dir` to intent arg parsing + usage, validated via `validateTargetDir`.
- [ ] Thread the resolved override (flag-first) into seed-input check, committed ready-intent write, and next-steps output.
- [ ] Tests for the override path; keep existing intent tests green.
- [ ] Docs: `v1/docs/intent-mode.md`, `v1/docs/config.md` targetDir note, `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] `jarvis1 intent --target-dir <dir> <seed>` is accepted; an invalid value (absolute, `..` traversal, or empty) fails with an `intent:` error before any seed/worktree work, matching `jarvis1 plan --target-dir` validation.
- [ ] With `--target-dir <dir>`, a file seed must live under `<dir>/wip-intents/` (rejection message names the overridden `<dir>`), and committed authored intents are written under `<dir>/ready-intents/` — the override, not project/global `plan.targetDir`, governs both.
- [ ] The printed next-steps `jarvis1 plan ...` path references the overridden `<dir>/ready-intents/<name>.md`, matching where files were written.
- [ ] Without the flag, target-dir resolution is unchanged (project `plan.targetDir` → global → `"spec"`): `intent-command.test.ts` stays green.
- [ ] A new test covers the `--target-dir` override routing seed-input and committed ready-intent output to the overridden tree.

## Documentation updates

- [ ] `v1/docs/intent-mode.md`: document `--target-dir` (precedence + validation, parity with plan).
- [ ] `v1/docs/config.md`: note `--target-dir` is honored by `jarvis intent` as well as `jarvis plan`.
- [ ] `v2/docs/v1-behaviors.md`: update the intent flag-surface and target-dir-routing entries to record that intent now accepts a per-run `--target-dir` override.
