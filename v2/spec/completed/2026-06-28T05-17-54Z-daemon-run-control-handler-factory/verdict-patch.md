## Verdict — required outcomes

1. **Complete inline doc-comments on `RunControlHandlerDeps` and `createRunControlHandlers` per `v2/docs/documentation-standard.md`.**  
   AC #3 requires full contract coverage (purpose, params/fields, returns, thrown errors, invariants), not partial commentary. Current comments omit: per-field expectations for `stateStore`; explicit return shape (`start`/`list`/`pause`/`resume`/`kill` as `RpcHandler`s); that handlers signal rejections via `{ kind: "error", ... }` rather than throws; fire-and-forget write-loop spawn and that `writeLoopExecutor` rejections do not propagate to RPC callers; fresh `_registry` and `activeRuns` per factory invocation. Without this, the exported API contract is incomplete against an explicit acceptance criterion.

2. **Correct the stale `resumeHandler` inline comment** that still refers to `executeWriteLoop`. It must describe the actual path (`spawnWriteLoop` → injected `writeLoopExecutor`). Misleading inline docs violate the documentation standard’s “comment must add information the code cannot” rule in the negative.

3. **Reconcile `intent.md` with the subspec on `logReader`.** Seed intent still lists `logReader` as a factory dependency; the authoritative subspec omits it (tail-only). Leaving the contradiction will mislead readers and the follow-on intent. Narrow or supersede the seed decision so it matches implemented factory deps.

4. **Narrow `v2/spec/ready-intents/daemon-start-list-use-real-handlers.md` on `logReader`.** Its prerequisite still requires the factory to accept an injected log reader, which conflicts with this slice’s decision and implementation. Update prerequisite/decisions before that intent runs so follow-on work does not reintroduce a dep this slice explicitly excluded.

**Not required for this slice:** factory test coverage (deferred to follow-on); `spawnWriteLoop` stale-`activeRuns` on claim throw (pre-existing); exported `WriteLoopExecutor` alias or named factory return type (deferred); preservation-test parity or weak duplicate tests (explicitly preserved); `resume` terminal-status semantics for `killed`/`paused` (pre-existing, out of scope).
