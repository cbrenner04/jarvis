# Move process-group predicate to shared

## Problem

`ownProcessGroupIds` and `isForeignProcessGroup` live in `v2/src/execution/verifier-process-groups.ts`, but `singleSpawn` in `shared/invocation/agents.ts` needs the same foreign-group skip rule when signalling descendant agent shell sessions. `shared/**` must not import from `v2/**`.

## Decision ledger

- Relocate `ownProcessGroupIds` and `isForeignProcessGroup` (and their existing semantics: own set is `{ process.pid }`, foreign means integer `pgid > 1` not in own) into a new `shared/` module; rules out duplicating the predicate in `agents.ts` or importing `v2` from shared.
- Keep `trackProcessGroup`, `VerifierProcessGroupRecorder`, and `storeVerifierProcessGroupRecorder` in `v2/src/execution/verifier-process-groups.ts`, importing the predicate from shared; rules out moving verifier recording into shared in this change.
- Re-export the two predicates from `verifier-process-groups.ts` for existing v2 importers (`daemon.ts`, tests); rules out a wide v2 import-path churn in the same patch as the reap behavior.

## Task checklist

- Add shared module with `ownProcessGroupIds` and `isForeignProcessGroup` (preserve current implementations and comments tiered per `v2/docs/documentation-standard.md`).
- Update `verifier-process-groups.ts` to import from shared and re-export the predicates.
- Leave `verifier-process-groups.test.ts` exercising the predicates through the v2 entry path.

## Acceptance criteria

- [x] `v2/src/execution/verifier-process-groups.test.ts` stays green (predicate behavior unchanged by the move).

## Documentation updates

- None (internal module boundary only).
