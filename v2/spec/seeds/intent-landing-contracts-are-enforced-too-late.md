---
name: intent-landing-contracts-are-enforced-too-late
---

# Intent landing contracts are enforced after the agent is gone

## Problem

The intent landing step validates emitted ready-intents against several shape contracts. Every
violation settles the run `landing_failed` (`resumable: true`) with the staged files still on
disk, and the only recovery is an operator hand-editing `.jarvis-intent-stage/` and running
`jarvis run resume`. The agent that produced the violation is long gone and never sees the rule.

Both occurrences below are from one session, on two different rules, on the two intents that were
actually run:

1. `intent: surface-contract-miss-reason-on-run-rows.md must list prerequisites as one bullet per
   line; rerun to retry pre-publication` — a `## Prerequisites` bullet wrapped onto a second line.
   Recovery: join the two lines, resume (#2366).
2. `intent: invalid emitted filename 00-pipeline-branch-keyed-stage-records.md; expected <name>.md
   with no ordering prefix; rerun to retry pre-publication` — the split emitted subspec-style
   `NN-` prefixes. Recovery: rename four files, resume.

Both messages are good — they name the file and the rule. The defect is *when* they fire. The
harness already has the right pattern for this shape of problem: a `blocked` outcome with no
`## Blocker` section **reprompts the agent** rather than settling for the operator
(`missing_blocker`). Landing contracts get no such loop.

Cost is one hand-edit plus one resume per violation, and it lands on the operator at the least
convenient moment — mid-pipeline, where it also fails the enclosing pipeline stage.

## Decisions

- A landing-contract violation reprompts the write agent with the violation text and the offending
  file, within the existing iteration budget, before settling anything — same shape as the
  `missing_blocker` reprompt. Rules out settling `landing_failed` on the first violation.
- Only after the reprompt budget is spent does the run settle `landing_failed` for the operator,
  preserving today's stage contents and `resume` recovery — rules out removing the manual path.
- The contracts are also stated in the **injected intent write-step rules**, so the agent is
  constrained before it writes rather than corrected after — rules out fixing only the recovery
  loop and leaving the prompt silent. A rendered-prompt test pins the text.
- Purely mechanical violations that have exactly one correct repair — an ordering prefix on an
  emitted filename — are normalized by the harness instead of reprompting; rules that require
  judgment (prose reflow) reprompt. Rules out silently rewriting content the agent meant.
- Out of scope: changing the contracts themselves. One-bullet-per-line and no-ordering-prefix stay
  as they are; this seed is about enforcement timing.

## Acceptance criteria

- [ ] An intent landing that violates the prerequisites one-bullet-per-line contract reprompts the
      write agent with the violation message and the offending file rather than settling; a test
      pins the reprompt and fails against the pre-fix code (which settles `landing_failed`
      immediately).
- [ ] After the reprompt budget is exhausted with the violation unfixed, the run settles
      `landing_failed` with today's `resumable: true` / `nextAction: "resume"` and the stage
      contents intact; a regression covers it.
- [ ] An emitted ready-intent filename carrying an `NN-` ordering prefix is normalized by the
      harness to the unprefixed name and lands without a reprompt; a test pins the landed name and
      fails against the pre-fix code.
- [ ] The injected intent write-step rules state the emitted-filename and prerequisites contracts;
      a rendered-prompt test pins both.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — landing contracts reprompt before they settle; which are
  normalized and which reprompt.
- `v2/docs/operator-runbook.md` § Intent finalization failed with staged files remaining — note
  that a settled `landing_failed` now means the reprompt budget was already spent.
- `v2/docs/v1-behaviors.md` — record the changed intent landing failure behavior.

## Prerequisites

- `landIntentWorkflowOutput` shape validation and its `landing_failed` settle
- The `missing_blocker` reprompt loop, as the pattern to follow
- Injected write-step rule rendering and its prompt tests
