# Route and guard blocker append

## Problem

- A `plan.draft.blocker` contract miss during `plan.prompt.draft` resolves its harness blocker target beneath the unpublished durable spec directory, so append creates a bare file that obstructs later publication and escapes staged-artifact cleanup.
- Generic contract-miss settlement appends without validating the target, so an absent or non-file target can be created or throw instead of preserving the settled failure.

## Decisions

- Route every `plan.prompt.draft` contract-miss blocker to staged `<expectedArtifactPath>/intent.md`, with the failed contract ID retained only as failure identity; rules out per-contract routing and any pre-publication write beneath `specPath`.
- An append target is eligible only when `lstat` finds a direct regular file; symlinks, including symlinks to regular files, are ineligible. An append failure after eligibility propagates and does not receive best-effort terminal settlement; race hardening is out of scope.
- Persist a harness blocker only to an eligible target; rules out creating absent targets or writing non-file targets.
- Preserve contract-miss detail logging and terminal settlement when append is skipped; rules out converting append safety into a new invocation or settlement failure.

## Tasks

- Change write-loop contract-miss target resolution and blocker append safety at the shared settlement seam.
- Add focused plan-draft routing, staged-target absence/non-file, eligible-append failure, and preservation coverage in `v2/src/execution/write-loop.test.ts`, with in-body mutation directives on each added or modified guard.
- Update `v2/docs/write-behavior.md` and `v2/docs/v1-behaviors.md` to distinguish staged target resolution from conditional blocker persistence.

## Acceptance criteria

- [ ] `v2/src/execution/write-loop.test.ts` — `plan-draft blocker contract_miss appends plan.draft.blocker to staged intent.md` fails against the pre-fix code, settles `plan.draft.blocker`, appends to staged `<expectedArtifactPath>/intent.md`, and leaves the durable spec-directory path absent; Keystone checkpoint: an in-body `// @mutate` directive reverts the all-contract `plan.prompt.draft` route to the prior `artifact.exists`-only route and turns this pin RED.
- [ ] `v2/src/execution/write-loop.test.ts` — `plan-draft blocker contract_miss routes every failed contract to staged intent.md`; Mutation checkpoint: an in-body `// @mutate` directive inverts the `plan.prompt.draft` routing guard and turns this distinct pin RED.
- [ ] `v2/src/execution/write-loop.test.ts` — `plan-draft blocker contract_miss skips absent or non-file staged intent.md` fails against the pre-fix code and, for absent, directory, and symlink-to-file staged targets, keeps `plan.draft.blocker` logged and terminally settled without creating or replacing the staged target and without falling back to or modifying the durable spec path; Mutation checkpoint: an in-body `// @mutate` directive inverts the direct-existing-regular-file append guard and turns this pin RED by allowing a suppressed append.
- [ ] `v2/src/execution/write-loop.test.ts` — `contract_miss propagates append failure for eligible blocker target` proves an append failure to a direct existing regular file propagates before terminal settlement.
- [ ] `v2/src/execution/write-loop.test.ts` — `done/no-work with failing contract appends blocker and stops` stays green after asserting an eligible target receives the blocker and its checkpoint settles `contract_miss`.
- [ ] `v2/src/execution/write-loop.test.ts` — `plan-draft normalizer contract_miss appends blocker to staged intent.md` stays green, preserving `artifact.exists` routing.
- [ ] `v2/docs/write-behavior.md` states that every `plan.prompt.draft` contract miss resolves to staged `intent.md`, but persists a blocker only to a direct existing regular file; `v2/docs/v1-behaviors.md` records the same v2 behavior and append-failure propagation in the parity baseline.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — document all-contract plan-draft staged-target resolution, direct-regular-file-only persistence, skipped-target settlement, and append-failure propagation.
- `v2/docs/v1-behaviors.md` — record the v2 routing-versus-persistence behavior and append-failure semantics.
