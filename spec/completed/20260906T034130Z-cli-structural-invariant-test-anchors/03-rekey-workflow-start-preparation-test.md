# Re-key v2/src/commands/workflow-start-preparation.test.ts

## Problem

Rows `cli-wsp-posture-tables`, `cli-wsp-single-owner`, and `cli-wsp-prepare-calls` in `v2/docs/structural-invariant-test-audit.md` pin workflow-start authority to duplicated registry literals, one-way production-tree absence scans, and a hand-maintained `PREPARE_CALL_ALLOWED_PATHS` set.

## Decision ledger

- `cli-wsp-posture-tables` asserts realizability and posture-to-preset coverage through exported registry tables and resolver properties, not duplicated literal arrays beside the imports; rules out `expect(BASE_WORKFLOW_NAMES).toEqual([...])` copies in the test.
- `cli-wsp-single-owner` pairs forbidden declaration absence outside the owner with presence inside via loud-failure symbol slicing on exported owner markers; rules out one-way `expect(source).not.toMatch` scans without owner presence checks.
- `cli-wsp-prepare-calls` discovers `prepareWorkflowStart(` call sites across production sources and pairs allowlisted absence elsewhere with presence in the owner and pipeline adapter via export-resolved paths; rules out `PREPARE_CALL_ALLOWED_PATHS` as a hand-maintained path set.
- Production source walks route file reads through `shared/structural-test-locator.ts` where slicing is required; rules out silent empty reads when a scanned path moves.

## Task checklist

- [x] Re-key audit rows `cli-wsp-posture-tables`, `cli-wsp-single-owner`, and `cli-wsp-prepare-calls` per the decision ledger.
- [x] Adopt shared loud-failure locators for owner and adapter source slicing in this file.
- [x] Reuse the move-pairing helper pattern from subspec 00 where prepare-call ownership is asserted.

## Acceptance criteria

- [x] `v2/src/commands/workflow-start-preparation.test.ts` test `realizes every supported workflow and review posture` asserts registry coverage via exported tables and resolver properties without duplicated literal expected arrays; it fails against the pre-fix hardcoded equality pins reachable in that test and passes after re-key.
- [x] `v2/src/commands/workflow-start-preparation.test.ts` test `production realizability and posture-to-preset tables live only in the shared owner` pairs forbidden-declaration absence outside the owner with owner presence via loud-failure symbol slicing; it fails against the pre-fix one-way absence scan reachable in that test and passes after re-key.
- [x] `v2/src/commands/workflow-start-preparation.test.ts` test `production prepared-step assembly lives only in shared preparation and the pipeline adapter` discovers prepare-call sites from production exports rather than a hand-maintained path allowlist; it fails against the pre-fix `PREPARE_CALL_ALLOWED_PATHS` set reachable in that test and passes after re-key.
- [x] `v2/src/commands/workflow-start-preparation.test.ts` — `production prepared-step assembly lives only in shared preparation and the pipeline adapter` stays green.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

None — patterns land in `v2/docs/test-writing.md` via a later intent.
