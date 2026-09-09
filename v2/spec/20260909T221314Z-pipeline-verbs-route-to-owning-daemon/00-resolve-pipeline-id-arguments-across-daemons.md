# Resolve a CLI pipeline id argument across every live daemon

## Problem

`pipeline list` prints short unique id prefixes (≥8 chars), and every single-pipeline verb accepts them today: the invoking daemon resolves a prefix locally via `resolvePipelineIdArgument` against its own store, refusing `pipeline_id_ambiguous` when the prefix matches more than one id in that store. Routing verbs by pipeline owner (see the linked routing subspec) needs a socket to query before it knows which daemon's store to resolve against, and the daemon-side `pipeline_owner` RPC deliberately does full-id `store.loadPipeline` lookup only — no prefix support (`v2/src/daemon/daemon-pipeline-handlers.ts`). Sending a raw prefix straight into owner resolution would answer `pipeline_not_found` for a legitimate, currently-working prefix. This subspec adds the cross-daemon resolution step that closes that gap, independent of the routing change that consumes it.

## Decisions

- A new resolver queries `pipeline_list` (with `includeDismissed: true`) across every live discovered-plus-invoking socket via the existing `queryPipelineListsFromSocketPaths`/`mergePipelineSnapshots` pair, then matches the CLI argument against the merged id set the same way `resolvePipelineIdArgument` does: exact id wins, else a ≥8-char argument that strictly prefixes exactly one id resolves to it; rules out a per-socket-only resolution that misses ids living in a different daemon's store than the one queried first.
- `includeDismissed: true` is used unconditionally so `dismiss`/`undismiss` keep resolving already-dismissed ids by prefix, matching today's per-daemon behavior; rules out a resolver that silently stops supporting prefixes for dismissed pipelines.
- A ≥2-id match refuses immediately with the existing `pipeline_id_ambiguous` message and candidate list (`ambiguousPipelineIdMessage`), before any further RPC; rules out a cross-daemon merge silently picking one of several matching ids.
- A zero-id match returns the argument unresolved; the caller (the routing subspec) keeps its own not-found handling for that raw argument — rules out this step inventing a second not-found message.
- This resolution never starts a daemon, same constraint as `pipeline list`.

## Task checklist

- [ ] Add the cross-daemon id-resolution function next to `pipeline-daemon-resolution.ts` (or a co-located module), consuming the existing merge/query helpers.
- [ ] Add its regressions to `v2/src/commands/pipeline.test.ts` or a co-located unit test for the new module.

## Acceptance criteria

- [x] A regression test proves an argument that uniquely prefixes one pipeline id across the merged, cross-daemon listing resolves to that full id — the reachable pre-fix gap being that no such cross-daemon resolution exists yet, so nothing before this subspec can turn a prefix into a routable full id.
- [x] A regression test proves an argument prefixing ids in two different daemons' stores refuses with the existing `pipeline_id_ambiguous` message, naming every matching candidate, without issuing any further RPC.
- [x] A regression test proves a dismissed pipeline's full id still resolves via the merged listing (`includeDismissed: true`).
- [x] A regression test proves an argument matching zero ids returns unresolved rather than refusing.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.

## Documentation updates

None — this adds an internal resolution step with no operator-facing behavior change on its own; the routing subspec's docs cover the observable outcome.
