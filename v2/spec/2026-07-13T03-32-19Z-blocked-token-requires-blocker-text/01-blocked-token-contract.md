# 01 - Blocked token runs a blocker-text contract

## Problem

`runStep` (`v2/src/execution/step-runner.ts:173`) returns `{ kind: "blocked" }` before
`evaluateContracts` runs, so `blocked` is the one terminal token whose promised artifact is never
checked. An agent can tick every acceptance criterion, emit `blocked`, write no `## Blocker`, and
the operator gets a non-resumable run with nothing to inspect.

## Behavior

- When a step declares a blocker-text contract and the token is `blocked`, the contract runs
  against the resolved spec file (the same path `appendBlockerToSpec` targets): the file gained a
  `## Blocker` section with a non-empty body during this invocation.
- Contract satisfied ⇒ ordinary terminal `blocked` (unchanged from today).
- Contract missed ⇒ one re-prompt asking the agent to write the blocker text, then re-check.
- Re-prompt satisfies the contract ⇒ ordinary terminal `blocked`.
- Second miss ⇒ the token is rejected: a terminal outcome distinct from `blocked` and from
  `contract_miss`, carrying the agent's response text from the re-prompted invocation.
- Only the default (implement) write declares the contract. Steps that do not (intent-split,
  plan-draft) keep today's short-circuit.

## Decisions

- The contract is a separate `runStep` input, not an entry in the existing `contracts` list —
  rules out running artifact contracts on `blocked` (a blocked agent has no artifact).
- The contract is named for blocker *text* (e.g. `write.blocker-text`), not `blocker` — plan-draft
  already has a gate named `plan.draft.blocker` whose polarity is the inverse (it *fails* when a
  genuine blocker exists); rules out one word meaning two opposite things.
- The check is a before/after comparison, not presence: the contract captures the spec file's
  content before the invocation and requires a non-empty `## Blocker` that was not there before —
  rules out a presence-only check, which `appendBlockerToSpec` (`write-loop.ts:778`, writes its own
  `## Blocker` on `contract_miss`) and any stale operator-authored blocker would satisfy,
  silently reproducing the bug this spec exists to fix. Same shape as `hasGenuineBlocker`.
- Blocker detection is the single shared parser from subspec 00 — rules out a second exact-heading
  parser that could drift.
- The rejected outcome names itself (`missing_blocker`) rather than reusing `contract_miss` —
  rules out an operator error whose `nextAction` is `inspect_spec`, which is the untruthful routing
  this spec exists to remove. (Pins the intent's deferred choice; subspec 02 is the first consumer.)
- Rejection mirrors `invalid_token` exactly: loop `kind: "invocation_failure"`,
  `runStatus: "paused"`, `outcomeKind: "missing_blocker"`, `resumable: true`, exit 2 — rules out
  `kind: "complete"` (which would gate open commit/publish on a rejected run), `blocked`
  (non-resumable) and `failed` (discards on-disk work).
- `missing_blocker` joins the persisted `OutcomeKind` union (`v2/src/persistence/state-store.ts:70`)
  and *not* `WriteLoopOutcomeKind` — same as `invalid_token`, whose loop kind is
  `invocation_failure`; rules out adding a member to the validated write-loop set that no loop
  result ever carries.
- The re-prompt is a new prompt artifact (`prompts/write/blocker-reprompt.md`, id
  `write.blocker-reprompt`, registered in `prompts/registry.txt`) asking only for blocker text and
  quoting the exact `## Blocker` heading the parser matches — rules out extending
  `write.token-reprompt`, which asks for a token and would let the agent silently switch to `done`,
  and rules out a paraphrased heading, which the exact-heading parser would reject.
- The blocker re-prompt does not reuse `StepRunResult.reprompt` — the write loop emits a
  `token_reprompt` log event unconditionally whenever that field is set (`write-loop.ts:217`), so
  reuse would mislabel a blocker re-prompt as a token re-prompt. It carries its own field and its
  own log event kind.
- Resume semantics are unchanged and out of scope: a resumed `missing_blocker` run behaves exactly
  as a resumed `invalid_token` run does today, including its existing limits for non-workflow runs
  — rules out new resume machinery in this spec.
- Scoped to the default write flavor. Plan-draft strands runs today by the same short-circuit, but
  its blocker home is `intent.md` and its gate means the opposite thing, so it needs its own
  design. Deferred to first consumer: whether plan-draft/intent-split gain blocked contracts — pin
  when one of those flavors is designed.

## Acceptance criteria

- [ ] A `blocked` token from a default write whose invocation added a `## Blocker` with a non-empty
      body to the resolved spec file terminates the run as `blocked` exactly as today
      (`write-loop.test.ts` blocked cases stay green).
- [ ] A `blocked` token with no new `## Blocker` triggers exactly one `write.blocker-reprompt`
      invocation before any terminal outcome is recorded.
- [ ] A `blocked` token whose spec file already carried a `## Blocker` before the invocation (e.g.
      appended by an earlier `contract_miss`) and gained none during it is treated as a miss, not a
      pass.
- [ ] If the re-prompt writes a `## Blocker` with a non-empty body, the run terminates as ordinary
      `blocked` (`runStatus: "blocked"`, `outcomeKind: "blocked"`).
- [ ] If the blocker is still missing after the re-prompt, the run terminates with loop
      `kind: "invocation_failure"`, `runStatus: "paused"`, `outcomeKind: "missing_blocker"`,
      `resumable: true`, and exit code 2 — not `blocked`, not `contract_miss`.
- [ ] The rejected result carries the re-prompted invocation's response text for the operator
      surface to log.
- [ ] The blocker re-prompt does not emit a `token_reprompt` log event.
- [ ] Steps that do not declare the blocker-text contract (intent-split, plan-draft) return
      `blocked` unchanged, and plan-draft's `plan.draft.blocker` gate is untouched.

## Documentation updates

- `v2/docs/shared-step-runner.md` — replace "`blocked` returns a typed blocked result and never
  runs contracts" with the blocker-text-contract + re-prompt + rejection ordering.
- `v2/docs/write-behavior.md` — the `blocked` outcome's contract, the `write.blocker-reprompt`
  artifact, and the `missing_blocker` outcome (incl. exit-code row).
- `v2/docs/v1-behaviors.md` — changed terminal-outcome behavior for `blocked`.
