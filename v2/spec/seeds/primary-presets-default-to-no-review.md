# The primary presets default to no review; the intended defaults sit on the legacy path

## Problem

`intent`, `plan`, and `implement` all default to **zero review passes**. Nothing reviews a v2 diff
before it becomes a PR unless the operator remembers a flag.

```ts
// v2/src/execution/publication-workflow-steps.ts:345  (intent)
const passes = input.reviewPasses ?? 0;
// v2/src/execution/publication-workflow-steps.ts:411  (plan)
const passes = input.reviewPasses ?? 0;
// v2/src/config/machine-config-loader.ts:131          (implement, when project config omits it)
if (value === undefined) return { ok: true, reviewPasses: 0 };
```

The intended defaults already exist — on the **deprecated** builders:

```ts
// :474  buildReviewedIntentWorkflowSteps
{ ...input, reviewPasses: input.reviewPasses ?? 1, reviewBehavior: input.reviewBehavior ?? "light" }
// :586  buildReviewedPlanWorkflowSteps
{ ...input, reviewPasses: input.reviewPasses ?? 1, reviewBehavior: input.reviewBehavior ?? "debate" }
```

So when `intent-reviewed` / `plan-reviewed` were demoted to `LEGACY_WORKFLOW_ALIASES` and the
primary presets became first-class, the review defaults did not move with them. The behavior
default did (`readProjectImplementReviewBehavior` already returns `"debate"`); only the pass count
was left behind.

### This is a silent divergence from v1

v1 reviews by default: `resolveReviewPasses` (`v1/src/config.ts:963`) falls back to
`cfg.modes.review.passes`, which is `1` in the live operator config. Every `jarvis1 run <spec>`
gets an adversary/advocate/adjudicator/actuator pass before its PR. The v2 operator running the
documented primary presets gets none, and nothing says so.

Observed 2026-07-21: five v2 implement PRs were driven with the documented command
(`jarvis run workflow implement --base main --spec …`). Zero review steps ran. Three of the five
carried a defect that the mechanical gates could not see and that manual diff review caught:

- a checkpoint reused across dispatches, silently skipping patch review on a re-run;
- a durable-step exclusion that rendered live review rows as `invocation_failure`;
- a finalization path that left `ready_flip_failed` / `runtime_smoke_failed` rows stuck
  `in-progress`, stranding them non-live forever and hanging `run wait`.

None was a coverage hole. Mutation verification checks that changed guards are constrained by
tests; it cannot judge whether a status transition is correct. That judgment is what the review
step exists to make, and it was not running.

## Decisions

- Default `reviewPasses` to `1` for all three primary presets; rules out leaving the intended
  default reachable only through deprecated aliases.
- Default `reviewBehavior` to `debate` for `plan` and `implement`, and `light` for `intent` —
  matching what the legacy builders already encode.
- Keep explicit CLI flags and project config as overrides, including `--review-passes 0` to opt
  out; rules out making review unskippable.
- The legacy aliases keep resolving to the same effective configuration, so they become
  no-ops rather than changing meaning.
- Rules out changing the operator's `~/.jarvis/config.json` to compensate; the default belongs in
  the code, where every project gets it.

## Prerequisite — cleared 2026-07-21

Reviewed **plan** had a recorded stranding defect (runbook, 2026-07-16: 3 for 3 producing a PR with
`.jarvis-plan-stage/` and no spec), which would have made a reviewed-by-default plan break every
plan run. **Verified fixed** before writing this seed: the reviewed-plan verdict landing work
(#1869) repaired it. `plan --review-passes 1 --review-behavior debate` on ready-intent
`workflow-command-reports-terminal-workflow-failure` produced PR #1877 containing `index.md`, its
subspec, `intent.md`, and a 104-line `verdict-plan.md`, with no stage directory — and the review
genuinely ran, returning a substantive "Required Refinements" verdict. Checked for `debate` only;
`light` was not re-tested, so cover both when implementing.

## Acceptance criteria

- [ ] `jarvis run workflow intent` with no review flags runs exactly one `light` review pass.
- [ ] `jarvis run workflow plan` with no review flags runs exactly one `debate` review pass, and
      lands its spec tree.
- [ ] `jarvis run workflow implement` with no review flags runs exactly one `debate` review pass.
- [ ] Explicit `--review-passes 0` still disables review on all three presets.
- [ ] Explicit CLI flags and project `implement.reviewPasses` / `reviewBehavior` still override.
- [ ] The legacy aliases produce the same steps as the primary presets with no flags.
- [ ] Coverage pins each preset's default pass count and behavior, and fails against the current
      `?? 0`.
- [ ] `bun run typecheck`, `test:v2`, `test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — per-preset review defaults.
- `v2/docs/operator-runbook.md` — remove the implication that review is opt-in; note how to opt out.
- `v2/docs/v1-behaviors.md` — record that v2 now matches v1's review-by-default, and that it
  previously did not.
