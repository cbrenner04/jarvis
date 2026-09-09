# `pipeline_owner` RPC answers durable pipeline ownership

## Problem

A daemon exposes pipeline state only through `pipeline_list`, whose snapshots are drawn from a shared `JARVIS_HOME` state store: every keyed daemon lists every pipeline, so a snapshot containing an id proves nothing about who owns it. Resolution across live sockets needs an ownership answer, not a snapshot. No RPC gives one today.

## Decisions

- Ownership is answered by a dedicated `pipeline_owner` RPC rather than by widening `pipeline_list` rows; rules out clients inferring ownership from snapshot membership, which is false under a shared store.
- The parameter is a full pipeline id; the handler does not prefix-resolve. Rules out two daemons resolving the same prefix to different ids and disagreeing about ownership of "it".
- Precedence: derived-terminal-state is checked before ownership, independent of `ownerIdentity`. An `active` row whose derived state is already terminal (owner alive, pipeline finished but not yet reconciled) answers `durable_state`, not `owner` — rules out a finished pipeline whose owner happens to still be up being routed as if further control RPCs against it made sense.
- Classification (row not derived-terminal): `owner` when `active` and `ownerIdentity` equals this daemon's identity; `not_owner` when `active` under any other identity, including `null`; `not_found` when absent. A `null`-owner active row is unowned rather than foreign-owned, but resolution treats it the same as foreign-owned — both fall through to `pipeline_no_live_owner`, whose `jarvis daemon start` recovery is what reconciles an unowned or dead-owner row.
- Classification (row derived-terminal or reconciled `interrupted`): `durable_state`, regardless of `ownerIdentity`. Rules out treating a reconciled or finished pipeline as unreachable merely because its former owner is gone.
- `durable_state` is answerable by any daemon, since it reads only the shared store; rules out gating terminal reads on the dead original owner.
- `StateStore` gains a public read-only accessor for the current owner identity. Rules out the handler recomputing the identity independently and drifting from the value the store stamps on rows.
- Dismissed pipelines are classified by the same rules; dismissal is a listing concern, not an ownership one.
- A missing or non-string `pipelineId` param returns a structured error frame, not `not_found`; rules out a caller's parse bug being silently read back as "pipeline doesn't exist".

## Task checklist

- [ ] Expose the store's current owner identity as a public read-only accessor.
- [ ] Add the `pipeline_owner` handler and register it on the daemon's RPC surface.
- [ ] Cover the four classifications, the terminal-precedes-ownership case, and the malformed-param case with tests.
- [ ] Update `v2/docs/daemon-host.md`.

## Acceptance criteria

- [x] `v2/src/daemon/daemon-pipeline-owner.test.ts`'s `classifies an owned active pipeline` regression proves an `active` row stamped with this daemon's identity answers `{kind:"owner"}`; it fails against the pre-fix code, where no `pipeline_owner` RPC exists.
- [x] `v2/src/daemon/daemon-pipeline-owner.test.ts`'s `classifies a foreign active pipeline` regression proves an `active` row under another identity, including a `null` owner, answers `not_owner` rather than `owner`.
- [x] `v2/src/daemon/daemon-pipeline-owner.test.ts`'s `classifies reconciled and terminal pipelines` regression proves an `interrupted` row and a terminal-derived-state row answer `durable_state`, including when the terminal row is `active` and stamped with this daemon's own identity — terminal precedes ownership.
- [x] `v2/src/daemon/daemon-pipeline-owner.test.ts`'s `classifies an absent pipeline` regression proves an unknown id answers `not_found` and no error frame.
- [x] `v2/src/daemon/daemon-pipeline-owner.test.ts`'s `rejects a malformed pipelineId` regression proves a missing or non-string `pipelineId` param returns a structured error frame rather than `not_found`.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/daemon-host.md` — add `pipeline_owner` to the RPC table with its four result kinds and the rule that a `pipeline_list` snapshot is not an ownership claim.
