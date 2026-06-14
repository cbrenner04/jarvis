# Verdict: plan intent refine flow

## Required outcomes

1. **Refine must not own naming.** After intent draft proposes `name:` and the branch/worktree rename at `plan: intent`, refine prompts and harness validation must not instruct or permit meaningful `name:` changes. Behavior and prompts must match subspecs 00/01 and `plan-mode.md`.

2. **Refine prompt must match the seeded intent layout.** Instructions and validation language must refer to the post-seed structure (`## Raw seed`, markers, `## Intent`) rather than a generic “human-authored seed above `## Refinement`.” Intent-draft and refine must describe the same file shape.

3. **`commit: false` must suffix-collide external spec dirs.** When the final plan name is chosen, collision checks must include `~/.jarvis/specs/<project>/` (or equivalent external root), not only in-repo `spec/`, worktrees, and remote branches. Two no-commit runs with the same derived name must not clobber each other (subspec 00 naming/collision decision).

4. **Committed fresh runs must clean up temp branch/worktree on failure.** After `plan/tmp-*` / `.worktree/plan-tmp-*` creation, failures before successful rename (intent-draft error, raw-seed validation, rename/git errors, etc.) must remove temp state. Subspec 00 requires cleanup on failed setup; today only `commit: false` intent-draft failure is covered.

5. **`plan-mode.md` cross-links.** Per subspec 01 and `v2/docs/documentation-standard.md`, operator/workflow decisions documented in `v2/docs/v1-behaviors.md` must be cross-linked from `plan-mode.md` — not duplicated only in subspec prose.

6. **`plan-mode.md` internal consistency.** Fix contradictions in the primary reference: duplicate `intent-draft.md` listing; stdout “Next steps” scoped to committed fresh-run handoff vs full-pipeline completion; remove or demote stale name-only fresh-run references; drop `plan: intent r<n>` from documented commit subjects unless resume actually emits it.

7. **`--resume-draft` + legacy gate blocker: end-to-end proof.** Acceptance criterion requires resume when only the historical generated gate blocker is present. Unit tests on `hasGenuineBlocker` are insufficient; add a `planCommand --resume-draft` integration test with legacy gate text in `intent.md` that asserts proceed (and keep genuine-blocker refusal covered).

8. **Intent-draft prompt snapshot fixture.** Subspec 00 requires updated prompt rendering tests/fixtures. Add a `plan.prompt.intent-draft@r*` rendered snapshot alongside draft/refine/review for revision-guard parity.

## Lower priority (address if touching nearby code; not merge blockers)

9. **Plan-level PR scoping test.** Subspec 01 acceptance claims scoped open-PR reuse; behavior lives in shared `ensureDraftPr`/`checkPrExists`. A plan handoff test injecting a closed PR as non-reusable would align the checkbox with proof.

10. **Telemetry namespace after rename.** Successful runs still key telemetry under the temp `tmp-*` name instead of final `plan-<name>`. Correlating JSONL to branch/spec by name stays harder than necessary.

11. **Literal `./missing.md` parser case.** Existing “non-existing path → inline” test covers the rule; one `./missing.md` case would align wording with acceptance criterion only.

12. **Peripheral doc drift.** `agents.md`, `workflows.md`, and similar files still cite removed inline-draft/no-arg/name-only fresh-run behavior. In-scope docs were updated; leftover references are operator hazards worth a follow-up pass outside this spec’s file list.

13. **Dead surface cleanup.** Remove `"interactive"` from commit/intent types where unused; trim duplicate PR URL on stdout; optional hardening of legacy blocker matching beyond substring heuristics.

## Rationale

Core behavior matches the spec: unified seed entry, `plan: intent` → `plan: refine`, clean `exit 0` handoff, telemetry phase/outcome fields, and substantial integration tests. Remaining gaps are spec contradictions (refine naming), operational holes (`commit: false` collisions, committed temp leaks), documentation obligations (cross-links, internal consistency), and acceptance-criteria honesty (legacy resume integration, intent-draft snapshot). Items 1–8 are required before treating the implementation as complete against the checked acceptance criteria and documented decisions.
