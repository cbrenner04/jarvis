# PR-sized work via intent fan-out — `jarvis intent` mode

**Scope.** Lives in `v2/spec/wip-intents/` for plan-mode routing. Implementation
is v1 harness work — changes land in `prompts/**`, `v1/**`, and docs. Not the v2
write loop or `v2/src/**`. v2 follows the documented behavior once v1 lands.

**Ordering.** First of three seeds (01 → 02 → 03). Enforcement of prerequisites
doesn't exist until 03, so these three are ordered by filename prefix — the
manual stand-in for the behavior-prerequisite mechanism this work builds.

## Problem

The implementation PRs that land are too big. Usually only a little; sometimes
*way* too big (~4k lines). The implementation matches the spec — the failure is
the planning unit. The post-completion shrink step removes bloat but cannot make
an oversized unit reviewable. Sizing has to happen *before* planning.

Earlier work (#220) tried to fix this by making subspecs the PR-sized merge
unit. That's a contradiction: subspecs live inside one spec PR, so they can't be
independently mergeable. Keep **one PR per spec**. The lever is the *count of
specs*, not the size of a subspec.

## Desired behavior

A seed fans out into N intents. Each intent → one spec → one PR (via the
existing `plan` + `run`). Subspecs stay commit-sized *inside* one spec PR — the
rest of the pipeline is unchanged.

New top-level mode:

```
jarvis intent "<prompt>"        (or a raw seed file from wip-intents/)
  → draft N intents             (split by independently observable behavior)
  → refine
  → write N intents to ready-intents/   (new dir)
  → commit → intent PR          (operator reviews the split itself)
```

- Reuses the existing intent-draft + refine machinery (moved out of `plan` — see
  seed 02 — or shared).
- **Split heuristic:** split along independently observable behaviors / distinct
  capabilities, preferring vertical slices ("add one capability") over umbrella
  bundles. ~1000 changed lines (incl. tests/docs) is a reviewability *warning*,
  not a hard cap and not the decision input. The number lives only in
  `v1/docs/spec-guidance.md`; the splitter prompt references the rule and never
  hardcodes the figure (plan-prompt coherence).
- **Dirs:** `wip-intents/` stays the raw-seed input. `ready-intents/` is the new
  output dir holding the N authored intents, ready for `plan`.
- **Prerequisites section:** each emitted intent carries a `Prerequisites`
  section listing the prerequisite *behaviors* it truly depends on — behaviors,
  not intent names; true dependencies only. **Declared and operator-honored,
  not enforced** in this seed. The format lands here so seed 03's enforcement is
  purely additive.

## Why intents up front, specs lazily

Intents are behavior-level and terse, so authoring all N up front is cheap and
low-speculation. The expensive detail — the spec with subspecs and ACs — stays
lazy automatically, because `plan` runs once per intent, when its turn comes,
against merged reality. Speculation-defense lands where it matters without
paying for it where it doesn't.

## Documentation updates

- `v1/docs/spec-guidance.md`: the sizing rule (subspec vs. intent vs. spec), the
  ~1000-line reviewability warning, `ready-intents/`.
- New mode doc (e.g. `v1/docs/intent-mode.md`): the `jarvis intent` flow.
- `v2/docs/v1-behaviors.md`: record the v1 behavior v2 should preserve.

## Out of scope

- The `plan` refactor (seed 02) and prerequisite enforcement (seed 03).
- Stacked-PR automation, PR batching, anti-fatigue workflow.
- Line-count enforcement in patch-mode implementation prompts.
