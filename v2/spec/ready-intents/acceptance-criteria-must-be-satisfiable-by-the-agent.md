---
name: acceptance-criteria-must-be-satisfiable-by-the-agent
---

# A subspec acceptance criterion the implement agent cannot satisfy is rejected at plan-draft, not stranded at `blocked`

A non-human-only acceptance criterion that asserts PR body/title, CI status, review
state, or any GitHub/network-only fact is unsatisfiable from inside the implement
agent's worktree. Today such a criterion sails through plan-draft and strands the
implement run at `blocked` because the agent honestly cannot tick it. Instead:

- The plan-draft validator flags a non-human-only AC that asserts PR body/title, CI
  status, review state, or a GitHub/network-only fact, at draft time — where it costs
  a review round, not a whole implement run.
- The plan-draft prompt states the rule directly: every non-human-only AC must be
  verifiable by the implement agent from inside its worktree, with no network and no
  GitHub. Such an assertion is either `human-only` or does not belong in Acceptance
  criteria.
- Evidence destined for a PR body is the publication step's job (`prNarrative`), never
  an agent-tickable criterion.

Mirror of the failing-test rule (#1546): that one made criteria *demand* evidence;
this one bars criteria demanding evidence the agent **cannot produce**. Land coherently
so "demand evidence" and "demand *obtainable* evidence" do not fight.

The `criteria-ticked` completion contract stays as-is — the contract is right, the
criterion is wrong.

## Prerequisites

- The plan-draft failing-test acceptance-criteria rule and validator (#1546) exist on the same prompt/guidance/validator surface

## Documentation updates

- `v1/docs/spec-guidance.md` — Acceptance criteria section: what a criterion may assert and the agent-verifiable rule.
- `v1/docs/operator-runbook.md` — a spec whose AC names CI or PR state strands every run at `blocked`; recovery is to fix the spec, not re-run.
