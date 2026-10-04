---
name: blocked-token-requires-blocker-text
---

# A `blocked` token with no `## Blocker` is a contract violation

## Problem

`runStep` short-circuits on `blocked` before any contract runs
(`v2/src/execution/step-runner.ts`), so a run reaches `runStatus: "blocked"` /
`agent_blocked` / `inspect_spec` with no `## Blocker` anywhere in the spec tree.
Observed 2026-07-13 on `jarvis run workflow implement`: the agent had ticked all
six criteria of subspec `00`, emitted `blocked`, and wrote no blocker. The
operator gets a non-resumable run, uncommitted work, and nothing to inspect.

`done`/`no-work` already verify their artifact (`artifact.exists`). `blocked`
promises an artifact and verifies nothing.

## Behavior

- A `blocked` token runs a contract: the spec tree carries a `## Blocker`
  section with non-empty body. Reuse the existing exact-heading parser
  (`extractBlockerSection`, `v2/src/execution/write.ts`).
- Missing blocker text ⇒ one re-prompt asking for it, same cheap-recovery shape
  as the missing-terminal-token re-prompt (`write.token-reprompt`). The work is
  already done; only the explanation is missing.
- Re-prompt satisfies the contract ⇒ ordinary terminal `blocked`
  (`inspect_spec` is now truthful).
- Second miss ⇒ reject the token: a distinct terminal outcome, and an operator
  error whose `nextAction` is **not** `inspect_spec` — there is nothing in the
  spec to inspect.
- The rejection is visible in the run log, carrying the agent's response text
  (same truncation as `invalid_token_detail`).

## Decisions

- Verify the token's artifact rather than trusting the token — rules out
  keeping `blocked` as the one unverified terminal token.
- Re-prompt once before rejecting — rules out hard-failing on the first miss,
  which discards completed work over a missing sentence.
- The re-prompt asks for blocker text, not for a different token — rules out
  re-litigating the token choice, which would let an agent silently convert a
  `blocked` into a `done`.
- Deferred to first consumer: whether the rejected outcome reuses
  `contract_miss` or names itself — pin when the operator-error mapping needs it.

## Out of scope

- The write loop's terminal-token parsing (unchanged).
- The implement prompt's token guidance (separate behavior).

## Documentation updates

- `v2/docs/write-behavior.md` — the `blocked` outcome's contract and re-prompt.
- `v2/docs/daemon-host.md` — operator error rows for the rejected outcome.
- `v2/docs/v1-behaviors.md` — changed terminal-outcome behavior.

## Prerequisites

- The write loop re-prompts once for a missing terminal token before failing.
- `done`/`no-work` terminal tokens are gated by an `artifact.exists` contract.
- Operator errors carry a `reason` / `retryable` / `nextAction` triple on `list` and `wait`.
