---
name: acceptance-criteria-must-be-satisfiable-by-the-agent
---

# A subspec acceptance criterion the agent cannot possibly satisfy strands the run at `blocked`

Plan agents write acceptance criteria that require things the implement agent **structurally cannot
do** — write a PR body, observe CI, reach the GitHub API. The implement agent does the real work,
ticks everything it can, and then honestly blocks on the one criterion it has no power over. The
run ends `blocked`, publishes nothing, and the operator hand-finalizes completed work.

Observed 2026-07-14 on `ready-gate-fails-on-any-red-test-file` (a spec drafted by the `plan` preset
earlier the same session). Four of five criteria ticked, real tests written. The fifth:

```md
- [ ] The reproduction from § Root-cause first is captured in the PR body: the tree/edit used,
      `bun run ready` output, ...
```

The agent appended:

```md
## Blocker
PR-body reproduction evidence remains to be added; GitHub API access failed in this session.
```

It was right to block. **The harness owns PR creation and the PR body** — the agent cannot write one
from inside its worktree, and no amount of retrying changes that. The criterion is unsatisfiable by
construction, so the run could only ever end `blocked`.

This is the mirror image of `acceptance-criteria-do-not-require-a-failing-test` (#1546, shipped):
that one made criteria *demand evidence*; this one is about criteria demanding evidence the agent
**cannot produce**. The two must be fixed together or plan agents will keep trading one failure for
the other.

## Decisions

- Spec guidance and the plan-draft prompt state the rule directly: **every non-human-only acceptance
  criterion must be verifiable by the implement agent, from inside its worktree, with no network and
  no GitHub.** A criterion about the PR body, PR title, CI status, or review state is either
  `human-only` or it does not belong in Acceptance criteria. Rules out today's "the agent will
  figure it out".
- Evidence that belongs in a PR body is the **publication step's** job (`prNarrative`), not an
  agent-tickable criterion. Rules out asking the agent to do the harness's work.
- Plan-review rejects a subspec carrying such a criterion. Rules out catching it only at implement
  time, which is where it costs a whole run.
- Rules out: relaxing the `criteria-ticked` contract so a run can complete over an unticked
  criterion. The contract is right; the criterion is wrong.

## Prerequisites

- `acceptance-criteria-require-a-failing-test` (#1546) — same prompt/guidance surface; land the two
  coherently so "demand evidence" and "demand *obtainable* evidence" do not fight.

## Out of scope

- Whether the implement agent *should* have network/GitHub access. It does not, and this seed does
  not argue it should.
- `human-only` criteria, which already exist for exactly this purpose and are correctly ignored by
  the completion contract.

## Documentation updates

- `v1/docs/spec-guidance.md` — the Acceptance criteria section: what a criterion may assert, and the
  agent-verifiable rule.
- `v1/docs/operator-runbook.md` — a spec whose AC name CI or PR state will strand every run at
  `blocked`; the recovery is to fix the spec, not to re-run.
