# Implement PRs omit the spec body template that plan PRs get

## Problem

v2 already has a v1-shaped PR body template (`deriveSpecRunBodySummary`,
`v2/src/execution/spec-run-body-summary.ts`): Subspecs, Commits, Risk cues, Change summary.
The workflow runner only enables it for plan (`workflow-runner.ts:801` — `landing.kind === "plan-tree"`
or `promptId === "plan.prompt.draft"`). Implement completion steps fall to `input.bodySummary`,
which is `undefined` on that path, so `refreshPrBody` writes only `Spec: <path>` + narrative + attribution.

Evidence — full body of implement PR #1854:

```text
Spec: v2/spec/20260721T005518Z-cleanup-stranded-owner-by-branch/index.md

<!-- jarvis:narrative:start -->
What changed and why — ...
<!-- jarvis:narrative:end -->

---

- 0d0206ea Match stranded spec owners by branch — codex

Written by codex through Jarvis.
```

Note `write-loop.ts:456` *does* set `specTemplate` for `patch.prompt.body`; the daemon-backed
workflow implement path does not. Consequence: implement PRs — the ones that need review — carry
the least review context of any Jarvis PR.

## Decisions

- Enable the spec template for implement completion steps in the workflow runner, matching the
  plan path and the ad-hoc write-loop `patch.prompt.body` path. Rules out authoring a second
  implement-only template.
- Derive the template from the same `deriveSpecRunBodySummary` seam; no new renderer.
- Keep the narrative marker block and attribution footer precedence unchanged.
- Deferred to first consumer: unifying v1 `v1/src/pr.ts` and v2 `pr-body-refresh.ts`/`pr-attribution.ts`
  into `shared/` — same-shape output is the requirement here, not shared code.

## Acceptance criteria

- [ ] A workflow implement PR body contains the Subspecs, Commits, and Change summary sections
      derived from its spec tree and branch diff.
- [ ] The risk cue (source changed with no test changes) appears on an implement PR that changes
      source without tests.
- [ ] Plan and intent PR bodies are unchanged.
- [ ] The narrative marker block and attribution footer still render, in the same order, after the
      template block.
- [ ] Regression coverage fails against current implement publication and passes after the change.
- [ ] `bun run typecheck`, `test:v2`, `test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — implement PR body composition.
