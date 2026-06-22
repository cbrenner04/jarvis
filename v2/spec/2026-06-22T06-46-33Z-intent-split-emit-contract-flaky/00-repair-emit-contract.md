# Repair mechanical emit contract instead of re-rolling

## Problem

The intent-split prompt tells the splitter to emit each ready-intent with `name:`
frontmatter matching the filename and a `## Prerequisites` section
(`v1/src/modes/plan/intent-split.ts:56-59`). `validateIntentStageContent`
(`v1/src/commands/intent.ts:205-253`) hard-rejects the entire run when any emitted
file misses either. The splitter complies only intermittently, so a pure
model-compliance flake aborts a ~$1.50 opus run and forces a re-roll.

Both contract elements are mechanical: the filename slug determines `name:`, and an
absent `## Prerequisites` means "no prerequisites" (empty section). The harness can
fix these in place before validation instead of re-running the agent.

## Decisions

- Repair scope = the two mechanical contract elements only: frontmatter `name:` and a missing `## Prerequisites` section — rules out reformatting prose/numbered prerequisite bodies, which the harness cannot losslessly convert and would corrupt.
- The filename slug is authoritative: a missing or mismatched `name:` is rewritten to equal the slug — rules out trusting frontmatter and renaming the file, since the slug already drives the `ready-intents/` filename and collision checks.
- Repair runs in both the committed and no-commit paths, before validation — rules out fixing only one path (both call the same staged-content validation).
- Genuine structural errors still abort with no partial `ready-intents/` writes or PR: disallowed filename (ordering prefix, `index`, bad chars), duplicate slug, malformed (non-bullet) `## Prerequisites` body, zero emitted files — rules out attempting to repair filenames or prose bodies.
- No single-behavior fast-path and no repair-retry turn. Deterministic post-processing makes the single splitter run's output pass the mechanical contract, eliminating the re-roll the flake caused; a model-free passthrough for single-behavior seeds is a separate cost optimization, deferred.

## Task checklist

- Add a deterministic repair pass over staged `.md` files (run before `validateIntentStageContent`) that sets frontmatter `name:` to the filename slug and appends an empty `## Prerequisites` section when absent.
- Wire the repair pass into both the committed and no-commit intent paths in `v1/src/commands/intent.ts`.
- Leave duplicate-slug, disallowed-filename, malformed-prereq-body, and no-files cases as hard rejects.
- Add tests for repair-then-succeed (missing `name:`, mismatched `name:`, missing `## Prerequisites`) in both paths; keep the malformed-prereq abort.
- Update docs.

## Acceptance criteria

- [ ] A staged intent file with no `name:` frontmatter is rewritten so its frontmatter `name:` equals its filename slug, and the run completes (committed: split commit + draft PR; no-commit: files written to external `ready-intents/`) instead of aborting.
- [ ] A staged intent file whose frontmatter `name:` does not match its filename slug is rewritten to the slug and the run completes; the previously-asserted `must declare name:` abort no longer fires for this case (the mismatched-name expectation in `v1/test/intent-command.sandbox-unrunnable.test.ts` is updated to assert success).
- [ ] A staged intent file missing a `## Prerequisites` section gets an empty `## Prerequisites` section appended and the run completes.
- [ ] Repair applies on both the committed (`commit: true`) and no-commit (`commit: false`) paths.
- [ ] A staged file with a non-bullet (malformed) `## Prerequisites` body still aborts the run with no partial `ready-intents/` writes and no PR — `v1/test/intent-command.sandbox-unrunnable.test.ts` "non-bullet prerequisites abort" stays green.
- [ ] Disallowed filenames (ordering prefix, `index`, characters outside `[a-z0-9-]`), duplicate slugs, and zero emitted files still abort with no partial writes and no PR.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v1/docs/intent-mode.md` — state that the `name:`/`## Prerequisites` emit contract is harness-enforced (repaired deterministically: name from filename, empty Prerequisites when absent), not model-trusted; malformed prerequisite bodies remain a hard error.
- `v2/docs/v1-behaviors.md` — update the intent-mode emit-contract bullet(s) (lines ~124, ~127) to record that missing/mismatched `name:` and a missing `## Prerequisites` section are repaired before validation rather than rejected, while malformed bodies and structural errors still abort.
