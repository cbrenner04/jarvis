---
name: plan-and-implement-prs-use-template-bodies
---

# Plan and implement PRs use deterministic template bodies

Plan and implement publication currently supplies either an index checklist summary
or no summary, so the PR body does not describe the completed change.

Port v1's default template narrative for plan and implement PRs. Rebuild it from the
linked subspec titles and bodies, branch commit subjects, and diff stats, while
retaining v2's spec header, narrative preservation, and attribution footer. Intent
PR bodies remain unchanged.

## Decisions

- Generate the v1-style template deterministically during publication; rules out an agent-authored narrative and its token cost.
- Apply the template to plan and implement PRs; rules out changing intent's existing staged-file summary.
- Keep v2's publication header, preserved narrative markers, and attribution footer around the template; rules out replacing the established refresh contract wholesale.

## Documentation updates

- `v2/docs/write-behavior.md` — plan and implement PR body inputs and rendered shape.
- `v2/docs/v1-behaviors.md` — v2 port of v1's template narrative.
- `v2/docs/first-workflow-walkthrough.md` — completed workflow PR body example.

## Prerequisites
