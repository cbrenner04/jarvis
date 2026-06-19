# Verdict — PR #226 "Plan consumes a ready-intent"

4A review of the branch diff (adversary → advocate → adjudicator → actuator). Findings upheld and the outcomes the actuator applied on this branch.

## Upheld findings

**A1 — Tests parked, not migrated.** 8 plan test files were renamed `.disabled`, so `bun test` went green by un-collecting failures, not by passing. ~160 tests dropped from the run.
→ Restored: obsolete files (intent-draft / refine / inline / fresh-seed / step-outcomes / finalspecpath-worktree-move) deleted outright; surviving-behavior files (`plan-command`, `plan-end-to-end`, `prompts`) migrated to the ready-intent model and re-enabled. Suite now runs them: 1051 pass / 0 fail.

**A2 — Dead `--resume-draft` machinery.** The flag returns 1 unconditionally, orphaning a blocker-check block, an entire resume-draft draft-phase block (~100 lines), the `mode` ternary, and `prepareResume`'s `"resume-draft"` mode.
→ Removed the unreachable blocks; resume now parses `mode: "resume"` only. (`--resume-draft` is still *parsed* and rejected with guidance — intentional UX, not dead.)

**A3 — Contradictory next-step text.** `renderPlanRefineHandoffNextSteps` advertised `jarvis1 plan --resume-draft …`, a now-rejected command.
→ Function deleted (also unused).

**A4 — `validateReadyIntent` shipped abandoned scaffolding.** `_targetDir` (unused param) and `_expectedDir` (computed, discarded) were underscore-suppressed; the location check degraded to a loose `endsWith("ready-intents")`.
→ Dropped both dead symbols; check is now exact (`basename(dir) === "ready-intents"`), rejecting e.g. `/x/not-ready-intents/…`.

**A6 — Dead exported helpers.** `seedIntentFile` (+ `SeedIntentFileOptions`/`SeedIntentFileMode`), `buildSeededIntent`, the frontmatter helpers, `_updateIntentName`/`_extractRawSeed`, `RAW_SEED_*`, plus (post-removal) `openOrRefreshDraftPr` and `countSpecFiles` had no callers.
→ All removed.

**A7 (new) — Usage no longer printed on bare `plan`.** `planCommand` still tested `result.message.includes("missing required seed")`, but the message was renamed to `…ready-intent`, so `PLAN_USAGE` stopped printing.
→ Predicate updated.

**A8 (new, most consequential) — Resume-refine crashed.** `refine.ts` still loaded `plan.prompt.refine` from the registry (live via `--resume --refine-turns`), but PATCH 2 deleted `refine.md` and the registry entry. So `jarvis1 plan --resume … --refine-turns N` threw `unknown prompt id`.
→ Per owner decision, **finished the removal** (refine never belonged in a post-draft resume under the new model): stripped refine from the resume path, dropped the `--refine-turns` flag/plumbing, and removed `refine.ts`. The file's only live code — the plan verdict-actuator (`runVerdictActuator`/`buildVerdictActuatorPrompt`, used by `review.ts`) — moved to `verdict-actuator.ts` (rename + refine code removed). `buildVerdictRefinePrompt` (loaded the deleted prompt; no caller) dropped.

## Not addressed (out of scope)

- **Resume a `jarvis run` after a spec completes.** Real gap, unrelated to #226. Plan `--resume` resumes plan-mode review, not a patch loop; patch mode has no resume-after-complete. Needs its own spec.
- **`plan-mode.md` still documents the removed intent/refine pipeline** (~45 refine references, `--refine-turns`, `--resume-draft` handoff). This is subspec-01's unfinished doc work — #226 retired those phases from fresh plan but left the phase reference describing them. Fixed only the directly-invalidated flag-surface line in `v1-behaviors.md`; the broader `plan-mode.md` rewrite belongs to that subspec, not this review.

## Gate

`bun run typecheck` ✓ · `bun test` 1051 pass / 0 fail ✓ · `biome lint` clean ✓
