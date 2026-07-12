# invalid_token hard-fails a successful step and discards the work it produced

The dominant v2 failure mode. Every write-loop preset (`intent`, `plan`,
`plan-reviewed*`) can do its job perfectly, write correct artifacts to disk, and
still be recorded as `failed` / `resumable: false` — because the agent's last line
was a prose summary instead of a bare terminal token.

## Problem

Observed 2026-07-12 on `main` at `4525d3a9`, reproduced on both `plan` and
`plan-reviewed-light`, and matching the operator's earlier `plan` /
`plan-reviewed` notes. Nearly every failed row in `jarvis run list` is
`invalid_token`.

```sh
jarvis run workflow plan --ready-intent v2/spec/ready-intents/run-async-path-terminal-log-event.md
```

```json
{"kind":"boundary_committed","outcomeKind":"invalid_token","runStatus":"failed"}
{"kind":"invalid_token_detail","tokenText":"Created the spec tree:\n\n- `index.md`\n- `00-settle-unhandled-async-run-failures.md`\n\nNo prerequisites were declared. `intent.md` remains unchanged. No tests run."}
{"kind":"loop_finished","loopOutcomeKind":"invocation_failure","iterationsConsumed":1,"resumable":false}
```

**The agent succeeded.** The spec tree it describes was really created —
`v2/spec/20260712T222237Z-run-async-path-terminal-log-event/` sits untracked in
the plan worktree, correct and complete. The `artifact.exists` contract
(`write.ts:214`) would have passed. The run is discarded anyway, is not
resumable, and the work is stranded outside git.

Two independent defects compose into this:

### 1. The contract instruction doesn't read as an output format

`stepRules` *is* wired correctly (`write.ts:183` → `buildPlanDraftPrompt` →
`shared/prompts/plan-draft.ts:66`). The rendered prompt ends with:

```
## Step completion

Return exactly one terminal token: done|no-work|blocked|progress.
```

That reads as an enum description, not a formatting rule. It never says the final
line of the response must be *exactly* that word and nothing else. A capable agent
"returns a terminal token" by summarizing its terminal state in prose. The parser
(`step-runner.ts:55-66`) requires a bare-token line and then does a lenient
last-word scan — `"No tests run."` matches neither.

### 2. A missing token is terminal, and takes the artifact with it

`write-loop.ts:582` maps `invalid_token` straight to
`{ kind: "invocation_failure", runStatus: "failed" }`. No re-prompt, no retry, no
fallback to the artifact contract that already passed. `resumable: false` means the
operator cannot even resume it — the only recovery is to hand-salvage the worktree
or re-run the whole draft and pay for it twice.

## Scope

- Make the token contract unmissable: state it as an output-format rule ("the final
  line of your response must be exactly one of `done`, `no-work`, `blocked`,
  `progress`, with nothing after it"), not as an enum. Applies to every write
  prompt — `plan-draft`, `intent-split`, and the default write prompt.
- Do not hard-fail on the first missing token. Re-prompt the agent once for the
  token alone (cheap, no re-work) before treating the step as failed.
- A step whose artifact contract passes must not be discarded for a token-parse
  miss. Decide the outcome from the artifact when the token is absent, or at
  minimum make the run resumable with the artifacts intact.

## Decisions

- Fix the prompt *and* the loop. Prompt-only leaves the loop one non-compliant
  agent away from discarding work again; loop-only leaves every run paying for an
  avoidable re-prompt.
- `invalid_token` must not imply `resumable: false` when artifacts are on disk —
  stranding completed work outside git is the worst possible outcome and the one
  the loop currently guarantees.
- Token parsing stays strict. The fix is to ask correctly and recover gracefully,
  not to loosen the parser into guessing intent from prose.

## Out of scope

- Retrying the whole write step (the work is already done; only the token is
  missing).
- The `implement` preset's separate first-launch failure — see
  `implement-linked-routing-reads-index-before-worktree-exists`.

## Documentation updates

- `v2/docs/write-behavior.md` — the terminal-token contract and the missing-token
  recovery path.
- `v2/docs/shared-step-runner.md` — token parsing already documented; record what
  happens when parsing finds nothing.
- `v2/docs/operator-runbook.md` — remove the manual worktree-salvage workaround
  once this ships.
