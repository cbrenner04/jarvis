# 00 - Publish deterministic plan and implement PR bodies

## Problem

- Plan publication repeats the spec checklist; implement publication supplies no change summary.
- Neither PR body describes the completed change without manual edits.

## Decisions

- Render the v1 patch-template shape for both plan and implement publication; rules out retaining plan's checklist-only shape or implement's empty summary.
- Build `## Subspecs`, `## Commits`, optional `## Risk cues`, and `## Change summary` from linked subspec titles and first prose lines, `baseRef..HEAD` commit subjects, and `baseRef...HEAD` numstat; rules out an agent-authored narrative or mode-specific input sets.
- Re-derive the template on every publication attempt; rules out persisting a summary that becomes stale before retry.
- Place the template after v2's `Spec:` header and before any preserved narrative markers and attribution footer; rules out making generated text human-preserved or replacing the refresh contract.
- Leave intent publication on its staged-file summary path; rules out applying the template to intent PRs.

## Work

- Replace the plan checklist summary derivation with a shared deterministic template renderer for plan and implement workflows.
- Port v1 parsing, truncation, risk-cue, numstat aggregation, ordering, and empty-input behavior with async Git reads suitable for v2 publication.
- Route plan and implement completion publication through the renderer without changing intent routing.
- Update the durable publication contract and walkthrough example.

## Acceptance criteria

- [ ] `v2/src/execution/spec-run-body-summary.test.ts` adds regression coverage that fails before this change and passes after it, pinning v1-style subspec why lines, commit ordering, risk cues, diff totals, area ordering, truncation, binary numstat handling, and empty inputs.
- [ ] `v2/src/execution/workflow-runner.test.ts` proves both plan and implement publication re-derive the deterministic template on retry from the current linked subspecs, branch commits, and diff stats; the new expectations fail against the baseline.
- [ ] Published plan and implement bodies retain the normalized `Spec:` header, preserved plain-marker narrative, and attribution footer around the generated template; `v2/src/execution/pr-body-refresh.test.ts` stays green.
- [ ] Intent publication retains its existing staged-file summary; `v2/src/execution/intent-run-body-summary.test.ts` and intent publication cases in `v2/src/execution/workflow-runner.test.ts` stay green.
- [ ] Template generation invokes no agent.
- [ ] `v2/docs/write-behavior.md`, `v2/docs/v1-behaviors.md`, and `v2/docs/first-workflow-walkthrough.md` document the plan/implement inputs, rendered order, retry behavior, and completed PR example.

## Documentation updates

- `v2/docs/write-behavior.md` — plan and implement template inputs and body order.
- `v2/docs/v1-behaviors.md` — record the v2 template-narrative port.
- `v2/docs/first-workflow-walkthrough.md` — replace the stale completed PR body example.
