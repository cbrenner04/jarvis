# Write-step rules forbid production invert hooks

Plan and implement write steps inject `DEFAULT_WRITE_STEP_RULES`. Drafted specs
say guard-inversion criteria must turn RED when guards invert; agents satisfy that
with production `setInvert*ForTest` exports, `invert*ForTest` module variables,
`invert*` parameters, or `invert*ForTest` type members — bypass plumbing that
stays green when the real guard is deleted.

## Decisions

- Extend `DEFAULT_WRITE_STEP_RULES` in `shared/prompts/step-rules.ts` only — rules out duplicating prose in `write-loop-input.ts` or patch artifacts.
- Intervention surface is trailing `## Step completion` in the constant — `draft.md` and injected `spec-guidance` guard-inversion prose are out of scope.
- Pin targets are v2 rendered `plan.prompt.draft` and `patch.prompt.body` only — v1 `jarvis1 plan` draft (no `stepRules`) is out of scope for plan coverage; `intent.prompt.split` and `patch.prompt.shrink` keep existing wholesale `toContain` coverage, no new substring pins.
- v1 `patch.prompt.body` inherits constant changes via the shared render path — fixture refresh is expected when bytes change, not optional.
- Guard-inversion criterion prose names **source mutation on the real guard** plus a **comment checkpoint on the pinning test** as the only acceptable evidence — rules out implicit “inverting each guard makes its regression RED” without naming the evasion.
- Same block forbids all four production hook shapes (`setInvert*ForTest` exports, `invert*ForTest` module variables, `invert*` function parameters, `invert*ForTest` type members) — rules out export-only wording from #2323–#2328.
- Write-step rules are necessary but not sufficient to stop invert hooks — `guard-production-test-flags` owns static enforcement; this spec owns the guard-inversion evidence contract and invert-hook prohibition in prompts and `test-writing.md` (hand off static enforcement there; do not duplicate).
- `v2/docs/test-writing.md` owns durable guard-inversion evidence and invert-hook prohibition — rules out scattering the same contract in `write-behavior.md` for this change.

## Tasks

- Append guard-inversion and invert-hook prohibition prose to `DEFAULT_WRITE_STEP_RULES` in `shared/prompts/step-rules.ts` (keep existing terminal-token lines).
- Add or extend `v2/src/execution/write.test.ts` render cases for `plan.prompt.draft` and `patch.prompt.body` with separate substring pins for source-mutation + comment-checkpoint evidence and each forbidden hook shape; add a comment on each case naming `DEFAULT_WRITE_STEP_RULES` as the inversion target (not `expect(...)` literals).
- Update `v2/docs/test-writing.md` per documentation updates.
- When `DEFAULT_WRITE_STEP_RULES` bytes change, regenerate v1 `patch.prompt.body` fixture content under `v1/test/fixtures/prompts/rendered/**` and ensure `bun run test:v1` (or `v1/test/prompts/rendered-snapshots.test.ts`) passes; bump template `@rN` revision only when `prompts/**` template bytes change.
- Run `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2` (if shared prompt surfaces require it), and `bun run test:v1`.

## Acceptance criteria

- [ ] New or extended `write.test.ts` cases for rendered `plan.prompt.draft` and `patch.prompt.body` (e.g. `intentSeed branch: agent-instructed write path matches the seeded/validated spec directory` and `patch.prompt.body resolves step placeholders and invokes binding`, or dedicated replacements) fail against pre-change `DEFAULT_WRITE_STEP_RULES` and pass after; each case uses separate substring pins for source-mutation + comment-checkpoint evidence and each forbidden hook shape—not wholesale `toContain(DEFAULT_WRITE_STEP_RULES)` alone.
- [ ] Each new or extended render case carries a comment naming `DEFAULT_WRITE_STEP_RULES` as the inversion target; removing or inverting the guard-inversion paragraph in that constant makes `write.test.ts` RED.
- [ ] `bun run typecheck`, scoped v2 tests for touched surfaces, and `bun run test:v1` (or `v1/test/prompts/rendered-snapshots.test.ts`) pass.
- [ ] `v2/docs/test-writing.md` documents source-mutation + comment-checkpoint guard-inversion evidence and forbids all four production invert-hook shapes.

## Documentation updates

- `v2/docs/test-writing.md` — guard-inversion evidence is a source mutation with a comment checkpoint on the pinning test; production invert hooks in all four shapes are forbidden; static enforcement lives in `guard-production-test-flags`.
