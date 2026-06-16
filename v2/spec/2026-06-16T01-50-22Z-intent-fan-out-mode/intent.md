---
name: intent-fan-out-mode
---

## Raw seed

<details>
<summary>Raw seed</summary>

<<<RAW_SEED_BEGIN>>>
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

<<<RAW_SEED_END>>>

</details>

## Intent

PR-sized work via intent fan-out — a new top-level `jarvis intent` mode.

**Scope.** v1 harness work: changes land in `prompts/**`, `v1/**`, and docs —
not the v2 write loop or `v2/src/**`. v2 follows the documented behavior once v1
lands. First of three ordered seeds (01 → 02 → 03); prerequisite enforcement
arrives in 03, so for now ordering is by filename prefix.

## Problem

Implementation PRs land too big — usually a little, sometimes ~4k lines. The
implementation matches the spec; the failure is the *planning unit*. The
post-completion shrink step removes bloat but can't make an oversized unit
reviewable. Sizing must happen *before* planning.

#220 tried making subspecs the PR-sized merge unit — a contradiction, since
subspecs live inside one spec PR and can't merge independently. Keep **one PR
per spec**; the lever is the *count of specs*, not subspec size.

## Desired behavior

A seed fans out into N intents; each intent → one spec → one PR via the existing
`plan` + `run`. Subspecs stay commit-sized *inside* a spec PR; the rest of the
pipeline is unchanged.

```
jarvis intent "<prompt>"        (or a raw seed file from wip-intents/)
  → draft N intents             (split by independently observable behavior)
  → refine
  → write N intents to ready-intents/   (new dir)
  → commit → intent PR          (operator reviews the split itself)
```

- **Reuse:** the existing intent-draft + refine machinery (moved out of `plan`
  per seed 02, or shared).
- **Split heuristic:** split along independently observable behaviors / distinct
  capabilities; prefer vertical slices ("add one capability") over umbrella
  bundles. ~1000 changed lines (incl. tests/docs) is a reviewability *warning*,
  not a hard cap and not the split decision input. That figure lives only in
  `v1/docs/spec-guidance.md`; the splitter prompt references the rule and never
  hardcodes the number (plan-prompt coherence).
- **Dirs:** `wip-intents/` stays the raw-seed input; `ready-intents/` is the new
  output dir holding the N authored intents, ready for `plan`.
- **Prerequisites section:** each emitted intent carries a `Prerequisites`
  section listing the prerequisite *behaviors* it truly depends on — behaviors,
  not intent names; true dependencies only. Declared and operator-honored, *not
  enforced* in this seed. The format lands here so seed 03's enforcement is
  purely additive.

**Why intents up front, specs lazily:** intents are behavior-level and terse, so
authoring all N up front is cheap and low-speculation. The expensive detail
(spec + subspecs + ACs) stays lazy — `plan` runs once per intent, in turn,
against merged reality.

## Documentation updates

- `v1/docs/spec-guidance.md`: the sizing rule (subspec vs. intent vs. spec), the
  ~1000-line reviewability warning, `ready-intents/`.
- New `v1/docs/intent-mode.md`: the `jarvis intent` flow.
- `v2/docs/v1-behaviors.md`: record the v1 behavior v2 should preserve.

## Out of scope

- The `plan` refactor (seed 02) and prerequisite enforcement (seed 03).
- Stacked-PR automation, PR batching, anti-fatigue workflow.
- Line-count enforcement in patch-mode implementation prompts.

## Refine skip

No load-bearing decision is missing. The intent already pins the non-default
choices: one PR per spec with spec-count as the lever; the splitter prompt
references the ~1000-line rule but never hardcodes the figure; the
`Prerequisites` section is declared/operator-honored but unenforced so seed 03 is
purely additive; intents authored up front, specs lazily. The remaining unstated
detail — `ready-intents/`'s path — is the obvious sibling of
`v2/spec/wip-intents/`, which a reasonable implementer reaches by default.
