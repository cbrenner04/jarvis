# Rename seed-input path in intent code and product docs

## Problem

`jarvis1 intent` reads file seeds from `<targetDir>/wip-intents/`, but the
artifacts are called **seeds** everywhere and "wip-intent" collides with the
distinct *intent* pipeline artifact. Rename the input directory to `seeds/` in
the code, its test, and the product docs that document the path. Pure
reference rename — no pipeline or semantic change.

## Decisions

- Rename `wip-intents/` → `seeds/` as the file-seed input directory; rejection
  message names `<targetDir>/seeds/`. Rules out keeping the old name aliased.
- Rename the `wipDir`/`wipDirRel` identifiers in `intent.ts` to `seedDir`/`seedDirRel`.
  Rules out leaving code that reads `seeds/` through a variable named for the old
  directory — the rename's premise is that "wip" misleads.
- `ready-intents/` is untouched (out of scope).
- Behavior is otherwise unchanged; the existing test is the pin, retargeted to
  `seeds/`.

## Task checklist

- [ ] `v1/src/commands/intent.ts`: seed-input path + rejection message use `seeds`; rename `wipDir`/`wipDirRel` → `seedDir`/`seedDirRel`.
- [ ] `v1/test/intent-command.sandbox-unrunnable.test.ts`: retarget the seed dir and assertions to `seeds/`.
- [ ] Update `v1/docs/intent-mode.md`, `v1/docs/plan-mode.md`, `v1/docs/spec-guidance.md`, `v1/docs/workflows.md`.
- [ ] Update the `wip-intents/` catalog entries in `v2/docs/v1-behaviors.md`, including correcting the `:132` citation from `intent-command.test.ts` to `intent-command.sandbox-unrunnable.test.ts`.

## Acceptance criteria

- [ ] `jarvis1 intent` resolves file seeds from `<targetDir>/seeds/`; a seed outside it is rejected with a message naming `<targetDir>/seeds/`.
- [ ] `intent-command.sandbox-unrunnable.test.ts` is retargeted to `seeds/` and stays green (behavior unchanged by the rename).
- [ ] No `wip-intents` literal and no `wipDir`/`wipDirRel` identifier remains in `v1/src/commands/intent.ts`.
- [ ] No `wip-intents` reference remains in `v1/test/intent-command.sandbox-unrunnable.test.ts`, `v1/docs/intent-mode.md`, `v1/docs/plan-mode.md`, `v1/docs/spec-guidance.md`, `v1/docs/workflows.md`, or the `wip-intents/` catalog entries in `v2/docs/v1-behaviors.md`.

## Documentation updates

- `v1/docs/intent-mode.md`, `plan-mode.md`, `spec-guidance.md`, `workflows.md`: replace `wip-intents/` with `seeds/`.
- `v2/docs/v1-behaviors.md`: update the entries naming `wip-intents/` to `seeds/` (existing-behavior change — keep the v1 parity baseline accurate).
