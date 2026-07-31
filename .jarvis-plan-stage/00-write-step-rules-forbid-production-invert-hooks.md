# Write-step rules forbid production invert hooks

Plan and implement write steps inject `DEFAULT_WRITE_STEP_RULES`. Drafted specs
say guard-inversion criteria must turn RED when guards invert; agents satisfy that
with production `setInvert*ForTest` exports, `invert*ForTest` module variables,
`invert*` parameters, or `invert*ForTest` type members — bypass plumbing that
stays green when the real guard is deleted.

## Decisions

- Extend `DEFAULT_WRITE_STEP_RULES` in `shared/prompts/step-rules.ts` only — rules out duplicating prose in `write-loop-input.ts` or patch artifacts.
- Guard-inversion criterion prose names **source mutation on the real guard** plus a **comment checkpoint on the pinning test** as the only acceptable evidence — rules out implicit “inverting each guard makes its regression RED” without naming the evasion.
- Same block forbids all four production hook shapes (`setInvert*ForTest` exports, `invert*ForTest` module variables, `invert*` function parameters, `invert*ForTest` type members) — rules out export-only wording from #2323–#2328.
- `v2/src/execution/write.test.ts` pins required substrings in rendered `plan.prompt.draft` and `patch.prompt.body` prompts via `DEFAULT_WRITE_STEP_RULES` — rules out changing `step-rules.ts` without render coverage.
- Comment-checkpoint guard inversion on the new render test documents that removing the guard-inversion paragraph from `DEFAULT_WRITE_STEP_RULES` must RED the test — rules out untested prompt prose.
- `v2/docs/test-writing.md` owns durable guard-inversion evidence and invert-hook prohibition — rules out scattering the same contract in `write-behavior.md` for this change.

## Tasks

- Append guard-inversion and invert-hook prohibition prose to `DEFAULT_WRITE_STEP_RULES` in `shared/prompts/step-rules.ts` (keep existing terminal-token lines).
- Add or extend `v2/src/execution/write.test.ts` so rendered `plan.prompt.draft` and `patch.prompt.body` prompts contain pinned substrings for source-mutation + comment-checkpoint evidence and each forbidden hook shape; add a comment checkpoint naming the inversion target; reference `DEFAULT_WRITE_STEP_RULES`, not copied literals alone.
- Update `v2/docs/test-writing.md` per documentation updates.
- Refresh `v1/test/fixtures/prompts/rendered/**` and bump revisions only if `DEFAULT_WRITE_STEP_RULES` bytes change v1 patch render output.
- Run `bun run typecheck` and scoped v2 tests (`bun run test:v2`, `bun run test:integration:v2` if shared prompt surfaces require it).

## Acceptance criteria

- [ ] `shared/prompts/step-rules.ts` states source mutation with a comment checkpoint for guard-inversion criteria and forbids production invert hooks in all four shapes; `v2/src/execution/write.test.ts` (or equivalent render test) fails against the pre-change rules.
- [ ] Inverting the pinned substring in the render test makes that test RED (comment checkpoint names the mutation target).
- [ ] `bun run typecheck` and scoped v2 tests for touched surfaces pass.

## Documentation updates

- `v2/docs/test-writing.md` — guard-inversion evidence is a source mutation with a comment checkpoint on the pinning test; production invert hooks in all four shapes are forbidden.
