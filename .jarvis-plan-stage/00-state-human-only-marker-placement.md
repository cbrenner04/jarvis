# State human-only marker placement in write prompts

## Problem

The parser accepts `(Manual)`, `visual inspection only`, and `no automated guard` anywhere in an
acceptance criterion's full bullet block. Plan-draft guidance still describes trailing markers, and
implement step rules omit the vocabulary and placement contract, so agents can author criteria
against obsolete anchoring assumptions.

## Decisions

- State the same three case-insensitive markers and free placement within the full criterion on both
  prompt surfaces — rules out undocumented first-line or trailing anchoring.
- Update `v1/docs/spec-guidance.md` for `plan.prompt.draft` injection and
  `DEFAULT_WRITE_STEP_RULES` for `patch.prompt.body` — rules out parser-only documentation.
- Pin marker vocabulary and placement freedom separately in rendered `plan.prompt.draft` and
  `patch.prompt.body` tests — rules out wholesale `toContain(DEFAULT_WRITE_STEP_RULES)` coverage.
- Keep parser behavior and marker vocabulary unchanged — rules out reopening classification semantics.
- Refresh rendered fixtures without prompt revision bumps because no `prompts/**` template bytes
  change — rules out treating injected-value changes as template revisions.
- No guard-inversion checkpoint is owed because the executable change is prompt text with no added
  or modified guard — rules out production inversion hooks or artificial control flow.

## Tasks

- Replace trailing-anchor wording in `v1/docs/spec-guidance.md` with the accepted marker vocabulary,
  full-bullet classification, and placement freedom.
- Extend `DEFAULT_WRITE_STEP_RULES` in `shared/prompts/step-rules.ts` with the same authoring contract.
- Add separate rendered-output substring pins in `v2/src/execution/write.test.ts` for bundled
  spec-guidance on `plan.prompt.draft` and step rules on `patch.prompt.body`.
- Refresh affected rendered prompt fixtures.
- Update durable docs listed below.
- Run `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, and
  `bun run test:integration:v2` per the shared-surface scope rule.

## Acceptance criteria

- [ ] A rendered `plan.prompt.draft` case in `v2/src/execution/write.test.ts` fails against the
      pre-change bundled spec guidance and passes after it names `(Manual)`,
      `visual inspection only`, and `no automated guard` and states that each may appear anywhere in
      the criterion's full bullet block.
- [ ] A rendered `patch.prompt.body` case in `v2/src/execution/write.test.ts` fails against the
      pre-change `DEFAULT_WRITE_STEP_RULES` and passes after it separately pins the same three markers
      and free placement; wholesale constant containment alone is insufficient.
- [ ] `v1/docs/spec-guidance.md`, `v2/docs/write-behavior.md`, and
      `v2/docs/v1-behaviors.md` describe prompt guidance consistent with the parser's existing
      full-bullet, case-insensitive marker classification.
- [ ] `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, and
      `bun run test:integration:v2` pass.

## Documentation updates

- `v1/docs/spec-guidance.md` — accepted markers and free placement within the full criterion block.
- `v2/docs/write-behavior.md` — `DEFAULT_WRITE_STEP_RULES` human-only authoring contract.
- `v2/docs/v1-behaviors.md` — plan and implement prompts expose the parser's marker vocabulary and
  placement semantics.
