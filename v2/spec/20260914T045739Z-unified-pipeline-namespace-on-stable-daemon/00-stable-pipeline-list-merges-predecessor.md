# 00 — Stable daemon merges predecessor pipelines into `pipeline_list`

## Problem

The stable-address `pipeline_list` handler returns only the answering generation's pipelines; draining-generation pipelines are visible only by querying keyed sockets. A silent local-only fallback on an unreachable predecessor also risks masking a pipeline the predecessor still holds, so a fallback must be observable to callers, not just tolerated internally.

## Decisions

- Wrap only the stable-address `pipeline_list` handler, the same object literal that carries `wait`/`pause`/`kill` via `createStableRunHandlers` (`daemon.ts`); the private-endpoint `pipeline_list` handler stays `pipeline.pipeline_list` unwrapped — else a predecessor querying its successor's private endpoint recurses.
- Predecessor address is `startupDeps.predecessorSocketPath` (`daemon.ts`, populated from `handoff.privateSocketPath` at handoff) — the same field `createStableRunHandlers` already forwards; the merge query targets that private endpoint, never the predecessor's public address.
- Merge local and predecessor snapshots via `mergePipelineSnapshots`, keyed under fixed synthetic labels `"local"` and `"predecessor"` rather than raw socket paths, so a same-id collision keeps the local snapshot deterministically: `"local"` sorts before `"predecessor"` and `mergePipelineSnapshots` keeps the earlier-keyed snapshot on a tie, independent of real socket path strings. Local wins because the incoming generation is the authoritative adopter of anything the predecessor was still tracking.
- The predecessor query carries its own timeout strictly shorter than the CLI's outer `PIPELINE_OWNER_RPC_TIMEOUT_MS` (`pipeline-daemon-resolution.ts`), leaving headroom for local processing so a slow predecessor can't push the stable reply past the CLI's own request timeout.
- Predecessor unreachable, timed out, or malformed → response carries `degraded: true` and local snapshots only, not an error — an exiting draining generation must not fail listing. No `predecessorSocketPath` configured → no merge attempted, `degraded` omitted (or false).
- Forward caller params (`includeDismissed`, `sinceMs`) unchanged to the predecessor; `sinceMs: 0` is what keeps a terminal/dismissed pipeline held only by the predecessor in the merged result.
- Scope is direct-predecessor only, matching `createStableRunHandlers`'s ownership routing — a grand-predecessor still draining behind the direct predecessor is not listed.

## Acceptance criteria

- [ ] A test drives the stable-address `pipeline_list` handler with local and predecessor snapshots sharing an id and asserts the merged result keeps the local snapshot for that id, with unchanged derived state and dismissal filtering; it fails against the pre-fix local-only handler.
- [ ] A test proves an unreachable predecessor yields local snapshots only with `degraded: true`, not an error.
- [ ] A test proves a predecessor exceeding its own query timeout is treated the same as unreachable (`degraded: true`, local snapshots only), and that the handler still replies inside the CLI's outer request timeout.
- [ ] A test proves querying the private-endpoint `pipeline_list` handler directly stays local-only — no predecessor merge, no `degraded` field — even with a predecessor configured.
- [ ] A test proves `includeDismissed` and `sinceMs` are forwarded to the predecessor unchanged, and that `sinceMs: 0` keeps a predecessor-only terminal pipeline in the merged result.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — stable-address `pipeline_list` merges the direct predecessor's pipelines, marks `degraded` when a configured predecessor doesn't answer in time, and stays local-only on the private endpoint.
