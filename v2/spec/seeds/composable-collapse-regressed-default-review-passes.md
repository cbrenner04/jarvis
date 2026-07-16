# Seed: composable-collapse regressed the default review passes to 0

## Problem

The workflow-composable-collapse changed the **bare** presets (`implement`, `plan`,
`intent`) to default `reviewPasses` to `0` — i.e. **no review at all** — and moved the
"1 pass" behavior onto the now-deprecated `-reviewed` aliases. Before the collapse the
defaults ran a review pass. This is a silent quality regression: every bare
`jarvis run workflow implement|plan|intent` now publishes with review disabled.

Evidence:

- `v2/src/execution/publication-workflow-steps.ts` — `buildIntentWorkflowSteps` and
  `buildPlanWorkflowSteps` both do `const passes = input.reviewPasses ?? 0;` and
  short-circuit to no review step when `passes === 0`.
- `v2/src/config/machine-config-loader.ts` — `readProjectImplementReviewPasses` returns
  `reviewPasses: 0` whenever `projects.<key>.implement.reviewPasses` is unset (which it
  is for the jarvis project).
- The `-reviewed` aliases (`v2/src/cli.ts` `LEGACY_WORKFLOW_ALIASES`) carry the real
  intent: `intent-reviewed` = 1/light, `plan-reviewed` = 1/debate,
  `plan-reviewed-light` = 1/light.

## Decisions

Restore the intended defaults so a bare preset reviews by default:

| Preset | default reviewPasses | default reviewBehavior |
| --- | --- | --- |
| `implement` | `1` | `debate` |
| `plan` | `1` | `debate` |
| `intent` | `1` | `light` (single critic) |

- Bare invocation (no `--review-passes`, no config override) must produce the row above.
- `--review-passes 0` must still explicitly disable review (opt-out preserved).
- An explicit `--review-passes`/`--review-behavior` flag still wins over the default.
- Config `projects.<key>.implement.reviewPasses`/`reviewBehavior`, when set, still wins
  over the default; only the *unset* default changes (0 → 1, debate).
- The deprecated `-reviewed` aliases keep working (they now coincide with the defaults).

## Acceptance criteria

- [ ] Bare `implement` builds a workflow whose review step runs 1 debate pass by default
      (no flag, no config).
- [ ] Bare `plan` builds a workflow whose review step runs 1 debate pass by default.
- [ ] Bare `intent` builds a workflow whose review step runs 1 light (critic) pass by default.
- [ ] `--review-passes 0` on each preset disables review (no review step).
- [ ] An explicit `--review-passes N` / `--review-behavior B` overrides the default.
- [ ] A set `projects.<key>.implement.reviewPasses` config value still overrides the default.

## Documentation updates

- `v2/docs/operator-runbook.md` — preset table: bare presets review by default again;
  note the flag/config opt-out.
- `v2/docs/workflow-runner.md` — default review passes/behavior per preset.
