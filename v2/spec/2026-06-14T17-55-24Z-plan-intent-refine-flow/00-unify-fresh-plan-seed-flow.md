# Unify fresh plan seed flow

Fresh `jarvis1 plan <seed>` runs use one entry path for inline text and file seeds. The seed becomes an intent-draft step that creates `intent.md`, proposes `name:`, and continues into the committed plan pipeline instead of stopping as an inline-only artifact.

## Decisions

- Treat a missing fresh-plan positional seed as usage error, ruling out no-arg intent scaffolding.
- Interpret the positional seed as a file only when it resolves to an existing file, ruling out the old inline one-shot path.
- Missing path-looking positional strings are inline seeds unless the path exists, ruling out file-not-found exits for `jarvis1 plan ./missing.md`.
- Reuse the inline-draft prompt as the intent-draft prompt, ruling out a second prompt with duplicate policy text.
- Move `name:` proposal into intent draft, ruling out refine/name-only ownership of fresh-run naming.
- File-seed frontmatter keeps non-`name` keys while `name:` is normalized or replaced by the intent step, ruling out stale invalid file names.
- Seed preservation means exact raw seed recoverability in `intent.md`, ruling out satisfying preservation with only an agent paraphrase.
- Invalid/missing names fall back to deterministic seed-derived names before collision suffixing; temp branches/worktrees are cleaned after successful rename or failed setup, ruling out invalid paths or leaked temp state.
- Keep `--refine-turns 0` legal for seeded runs, ruling out the old no-arg-only incompatibility.
- In `commit: false`, run intent, refine, draft, and review without PR handoff, ruling out committed-mode stop points where no commit or PR exists.

## Tasks

- Replace fresh-plan inline/file/no-arg branching in `v1/src/commands/plan.ts` and `v1/src/commands/plan-args.ts` with a required seeded fresh-run path plus existing resume modes.
- Rename or wrap `v1/src/modes/plan/inline-draft.ts` so the old inline-draft implementation becomes the intent-draft step.
- Run intent draft in the target plan spec directory, writing `intent.md` with preserved seed content and a `name:` frontmatter field.
- Preserve exact raw seed recoverability in `intent.md`; normalize/replace only
  `name:` in file-seed frontmatter while preserving other frontmatter keys.
- Move temporary worktree/branch rename and collision suffixing to follow intent draft naming.
- Add deterministic name fallback, branch/worktree/spec-dir collision suffixing,
  and temp worktree/branch cleanup on successful rename or failed setup.
- Remove fresh no-arg mode behavior and its `--refine-turns 0` rejection path.
- Update prompt rendering tests and fixtures for the intent-draft prompt name/role.
- Update CLI help and parser tests for the required seed and removed no-arg mode.

## Acceptance criteria

- [ ] `jarvis1 plan "some cool prompt"` creates a committed plan branch/worktree path and produces `intent.md` instead of writing `v1/spec/wip-intents/*` and exiting.
- [ ] `jarvis1 plan path/to/intent.md` follows the same fresh-run code path as inline text after seeding `intent.md`.
- [ ] `jarvis1 plan ./missing.md` treats the argument as inline seed text because the path does not exist (test).
- [ ] File-seed frontmatter preserves non-`name` keys and normalizes/replaces invalid or stale `name:` values (test).
- [ ] `intent.md` preserves exact raw seed recoverability for inline and file seeds (test).
- [ ] `jarvis1 plan` with no seed exits non-zero with plan usage before any agent invocation.
- [ ] `--refine-turns 0` on a seeded fresh run creates the intent step and skips refine without invoking the removed no-arg incompatibility error.
- [ ] `modes.plan.commit: false` runs through intent, refine, draft, and review in one invocation with no branch, commits, PR, or committed-mode handoff.
- [ ] Tests cover inline seed, file seed, missing path-like seed, no-arg rejection, invalid/missing names, collision suffixing, temp cleanup, `--refine-turns 0`, and `commit: false` flow.

## Documentation updates

- Update `v1/docs/plan-mode.md` input modes, phases, naming, flags, `commit: false`, and flow matrix.
- Update `v2/docs/v1-behaviors.md` plan-mode command surface and flow matrix entries.
- Update `v1/docs/spec-guidance.md` authoring-with-plan text if it still documents no-arg sessions or inline one-shot behavior.
