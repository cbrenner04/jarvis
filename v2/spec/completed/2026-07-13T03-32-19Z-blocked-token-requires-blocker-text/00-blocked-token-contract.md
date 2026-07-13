# 00 - Blocked token runs a blocker contract

## Problem

`runStep` (`v2/src/execution/step-runner.ts`) returns `{ kind: "blocked" }` before
`evaluateContracts` runs, so a `blocked` token is the one terminal token whose promised
artifact is never checked. An agent can tick every acceptance criterion, emit `blocked`,
write no `## Blocker`, and the operator gets a non-resumable run with nothing to inspect.

## Behavior

- When the step declares a blocker contract and the token is `blocked`, the contract runs:
  the spec tree carries a `## Blocker` section with a non-empty body.
- Contract satisfied ⇒ ordinary terminal `blocked` (unchanged from today).
- Contract missed ⇒ one re-prompt asking the agent to write the blocker text, then re-check.
- Re-prompt satisfies the contract ⇒ ordinary terminal `blocked`.
- Second miss ⇒ the token is rejected: a terminal outcome distinct from `blocked` and from
  `contract_miss`, carrying the agent's response text.
- A step that declares no blocker contract keeps today's behavior (`blocked` returns
  immediately). Only the default (implement) write declares one here.

## Decisions

- Blocker detection reuses `extractBlockerSection` (`v2/src/execution/write.ts`), exported or
  moved to a shared module — rules out a second `## Blocker` parser that could drift from the
  exact-heading contract patch mode enforces.
- The blocker contract is a separate `runStep` input, not an entry in the existing `contracts`
  list — rules out running artifact contracts on `blocked` (a blocked agent has no artifact).
- The rejected outcome names itself (`missing_blocker`) rather than reusing `contract_miss` —
  rules out an operator error whose `nextAction` is `inspect_spec`, which is the untruthful
  routing this spec exists to remove. (Pins the intent's deferred choice: subspec 01's operator
  mapping is the first consumer.)
- Rejection maps to `runStatus: "paused"`, mirroring `invalid_token` — rules out `blocked`
  (non-resumable) and `failed` (discards on-disk work); the agent's work is intact and a resume
  is the cheap recovery.
- The re-prompt is a new prompt artifact (`prompts/write/blocker-reprompt.md`, id
  `write.blocker-reprompt`) asking only for blocker text — rules out extending
  `write.token-reprompt`, which asks for a token and would let the agent silently switch to
  `done`.
- The blocker contract is declared only by the default write flavor — rules out inventing a
  blocker home for intent-split writes. Plan-draft's `plan.draft.blocker` gate is untouched.
  Deferred to first consumer: whether plan-draft/intent-split gain blocked contracts — pin when
  one of those flavors strands a run.

## Acceptance criteria

- [ ] A `blocked` token from a default write whose spec tree has a `## Blocker` with a non-empty
      body terminates the run as `blocked` exactly as it does today (`write-loop.test.ts` blocked
      cases stay green).
- [ ] A `blocked` token with no `## Blocker` (or an empty-bodied one) triggers exactly one
      `write.blocker-reprompt` invocation before any terminal outcome is recorded.
- [ ] If the re-prompt writes a `## Blocker` with a non-empty body, the run terminates as
      ordinary `blocked` (`runStatus: "blocked"`, `outcomeKind: "blocked"`).
- [ ] If the blocker is still missing after the re-prompt, the run terminates with
      `outcomeKind: "missing_blocker"` and `runStatus: "paused"` — not `blocked`, not
      `contract_miss`.
- [ ] The rejected result carries the agent's response text for the operator surface to log.
- [ ] `## Blocker` detection is the existing exact-heading parser, not a new one (single
      definition, imported by both call sites).
- [ ] Steps that declare no blocker contract (intent-split, plan-draft) return `blocked`
      unchanged.

## Documentation updates

- `v2/docs/shared-step-runner.md` — replace "`blocked` returns a typed blocked result and never
  runs contracts" with the blocker-contract + re-prompt + rejection ordering.
- `v2/docs/write-behavior.md` — the `blocked` loop outcome's contract, the re-prompt, and the new
  `missing_blocker` outcome (incl. exit-code row).
- `v2/docs/v1-behaviors.md` — changed terminal-outcome behavior for `blocked`.
