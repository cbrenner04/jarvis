---
name: outcome-token-parsing-matches-blocked-in-prose
---

# Outcome parsing matches `blocked` inside agent prose, pausing a run that completed its subspec

## Problem

Write-loop outcome classification scans the agent's response text for an outcome token. When the session log concatenates the terminal token with the agent's follow-up summary, that summary's ordinary prose participates in the match. An agent that finishes a subspec and then *describes* its work — "seeds a blocked run", "the blocked-lane regression", "asserts the run is blocked" — is classified `blocked`.

The harness then reprompts for a `## Blocker` section that does not exist, gets an explanation instead of a blocker, and settles `missing_blocker` → `paused` → `unsupported_resume_context`, which is **non-resumable**. Complete, committed, criteria-ticked work lands in a state whose only documented recovery is re-running the spec.

The failure is worst on exactly the specs most likely to say the word: anything implementing or testing blocked-run behavior. The run's own regression test naming its fixture is enough to trigger it.

## Evidence

Observed 2026-09-04, run `7475c190-5d0b-42b5-be22-da16467dafe4`, spec `20260904T044457Z-daemon-notification-wait-and-list` subspec 00. The write step completed the subspec — 3 of 3 acceptance criteria ticked, commit `f26bf53b` carrying the production fix and a 73-line regression test — then settled `missing_blocker` / `paused`, projecting `unsupported_resume_context`, `retryable: false`, `nextAction: "stop"`.

The agent's reprompted blocker text diagnosed it correctly and unprompted:

> Outcome misclassified: session log concatenated the terminal `done` with the follow-up summary (`doneSubspec`), so token parsing matched `blocked` in regression-test prose ('seeds a blocked run'). All acceptance criteria are satisfied; remove this section and resume.

Recovery was to delete the `## Blocker` section by hand, re-gate, and land the subspec as a slice (PR #3446). Nothing about the work was blocked, and the run row was actively misleading: `run wait` reported a non-resumable failure over a completed subspec.

Related but distinct: the runbook already records that `missing_blocker` can fire when the agent *did* append a blocker (run `4bfca748`, 2026-07-26). That case is a worktree-read problem. This one is upstream of it — the `blocked` classification itself is wrong, so the blocker never should have been requested.

## Decisions

- Outcome classification reads the terminal outcome token only, not the concatenated response body; a token-shaped word inside prose after the terminal token never changes the outcome. Rules out substring scanning over the whole response.
- When the classified outcome is `blocked` but the agent's staged spec has no `## Blocker` **and** the active subspec's non-human-only criteria are all ticked, the run settles as the completion path rather than requesting a blocker. Rules out reprompting for a blocker over demonstrably complete work.
- A `missing_blocker` settlement records the matched token and its surrounding text in the durable log, so the misclassification is visible without reading the worktree. Rules out an opaque settlement that costs an operator a worktree inspection to diagnose.

## Acceptance criteria

- [ ] A new write-loop test `outcome parsing ignores a blocked token inside prose after the terminal token` drives a response whose terminal token is `done` followed by summary prose containing the word `blocked`, and asserts the outcome is the completion path; it fails against the pre-fix substring scan.
- [ ] A new write-loop test `blocked classification over fully ticked criteria with no blocker section settles complete` asserts a run whose active subspec has every non-human-only criterion ticked and no `## Blocker` does not settle `missing_blocker`; it fails against the pre-fix reprompt path.
- [ ] A new write-loop test `missing_blocker settlement records the matched token evidence` asserts the durable log carries the matched token and surrounding text; it fails against the pre-fix opaque settlement.
- [ ] `bun run typecheck` and the `test:v2` pair pass.

## Documentation updates

- `v2/docs/write-behavior.md` — outcome-token classification reads the terminal token, not the response body.
- `v2/docs/operator-runbook.md` — § Blocked run: a `missing_blocker` / `paused` row over ticked criteria and a completion commit is a misclassification; check the subspec's criteria before re-running.
