# 00 - Terminal-line token, completion over ticked criteria, recorded evidence

## Problem

`parseStepOutcomeToken` (`step-runner.ts`) tries an exact match, then a bare-token line scanned from the end, then `TOKEN_WORD_PATTERN` over the **entire** stdout, taking the last token-shaped word anywhere. When the terminal `done` is glued to the agent's follow-up summary (`doneSubspec …`, observed in run `7475c190`), no bare line matches and the body scan lands on `blocked` in prose such as "seeds a blocked run". The write loop then requests a `## Blocker`, receives an explanation, and settles `missing_blocker` / `paused`, which projects `unsupported_resume_context` — non-resumable — over a subspec whose criteria are all ticked.

## Decisions

- The lenient scan reads only the last non-empty line of the response: the last token-shaped word on that line is the outcome, and a token-shaped word earlier in the body never is; a response whose last line carries no token takes the existing token-only reprompt path; rules out substring scanning over the whole response.
- When a `blocked` token arrives with no `## Blocker` staged and the active subspec's non-human-only acceptance criteria are all ticked, the write loop treats the iteration as `done` (completion path) instead of requesting a blocker; rules out reprompting for a blocker over demonstrably complete work.
- A `missing_blocker` settlement appends a durable `missing_blocker_detail` log record carrying the matched token and up to 200 characters of surrounding response text; rules out an opaque settlement that costs a worktree inspection to diagnose.

## Tasks

- Restrict the fallback scan in `parseStepOutcomeToken` to the final non-empty line.
- In the write loop's blocked handling, check the staged spec for a `## Blocker` and the active subspec's criteria before entering the blocker reprompt; route the all-ticked, no-blocker case to the completion path.
- Add the `missing_blocker_detail` event to `log-stream.ts` and append it where `missing_blocker` settles.

## Acceptance criteria

- [x] `step-runner.test.ts` test `outcome parsing ignores a blocked token inside prose after the terminal token` proves a response whose last line is `done` and whose earlier summary prose contains `blocked` parses as `done`, and a response whose only token-shaped word sits mid-body parses as no token; it fails against the current whole-body scan.
- [x] `write-loop.test.ts` test `blocked classification over fully ticked criteria with no blocker section settles complete` drives a `blocked` response against a subspec with every non-human-only criterion ticked and no `## Blocker`, and asserts the completion path (no blocker reprompt, no `missing_blocker`); it fails against the current reprompt path.
- [x] `write-loop.test.ts` test `missing_blocker settlement records the matched token evidence` asserts the durable log carries a `missing_blocker_detail` record with the token and surrounding text; it fails against the current opaque settlement.
- [x] Existing `parseStepOutcomeToken` and blocker-contract tests stay green.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — outcome-token classification reads the terminal line, not the response body; the all-ticked no-blocker completion rule; the `missing_blocker_detail` record.
- `v2/docs/operator-runbook.md` — § Blocked run: a `missing_blocker` / `paused` row over ticked criteria and a completion commit was a misclassification; read `missing_blocker_detail` before re-running.
