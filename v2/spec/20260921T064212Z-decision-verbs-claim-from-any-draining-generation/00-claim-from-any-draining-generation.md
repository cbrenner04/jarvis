# Decision verbs claim from any draining generation

## Problem

`approve`/`reject`/`resume`/`recover` on the stable endpoint confirm ownership only via the direct predecessor's `pipeline_owner` (`v2/src/daemon/daemon-stable-run-routing.ts`). A pipeline owned by an older live generation refuses `pipeline_no_live_owner` until that generation exits.

## Decisions

- Peer list is the daemon's existing peer-socket discovery (`enumerateSockets` result, `legacyPeerSocketPaths` in `v2/src/daemon/daemon.ts`), passed into the decision routing deps in place of the lone `predecessorSocketPath`; the stable daemon's own socket is excluded.
- Query `pipeline_owner` on every discovered peer and claim only from the one whose `{ kind: "owner", ownerIdentity }` matches the row's recorded `ownerIdentity`; not first-responder or direct-predecessor-only.
- Peer queries run in parallel under the existing `PREDECESSOR_PIPELINE_OWNER_QUERY_TIMEOUT_MS` (derived from `PIPELINE_OWNER_RPC_TIMEOUT_MS`); not sequential per-peer timeouts, which can exceed the CLI's outer RPC timeout.
- The lost-claim retry repeats discovery and queries across all peers.
- One atomic claim per pipeline; the verb itself is never sent to peers (only `pipeline_owner`).
- No draining signal beyond the witness: a peer answering a matching `owner` is the live owner. No match or unreachable owner refuses `pipeline_no_live_owner`, unchanged.
- Prefix resolution is unchanged: the listing merges only the direct predecessor and is `degraded` only when that query fails, so a prefix for a pipeline owned by an older generation stays unresolved and the operator passes the full id. Deferred to first consumer: widening the listing merge to every live generation — pin when a caller needs prefix resolution across older generations.

## Tasks

- [ ] Replace the single-predecessor owner witness with parallel discovery across live peer sockets.
- [ ] Claim from the matched generation; keep refusal paths and repeat discovery on the lost-claim retry.
- [ ] Update docs below.

## Acceptance criteria

- [ ] A test in `v2/src/daemon/daemon-stable-run-routing.test.ts`, using injected fake owner clients via `connectOwnerClient` (not the `.sandbox-unrunnable` variant), with three generations (owner two back from stable) proves `approve` claims and applies without waiting for the owner to exit; it fails against the pre-fix direct-predecessor-only claim.
- [ ] A test proves a peer with a mismatched `ownerIdentity` answering alongside the real owner does not receive the claim, and the claim goes to the matching owner.
- [ ] A test proves an unreachable owner and a non-matching `ownerIdentity` each still refuse `pipeline_no_live_owner`.
- [ ] A test proves a lost claim retries discovery across all peers.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` § Stable endpoint claims before running a decision verb.
- `v2/docs/operator-runbook.md` § Stable-address pipeline control verbs: verbs no longer wait for older generations to drain; prefixes for older-generation pipelines still need the full id.
- `v2/docs/v1-behaviors.md` claim-routing entry (`createStablePipelineDecisionHandlers`, "The stable endpoint now independently claims the pipeline first"): claim confirms against any live peer generation, not only the direct predecessor; the control-verb entry's "live draining direct predecessor" wording follows.
