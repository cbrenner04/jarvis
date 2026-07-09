Verdict: Refinement required.

**1. Subspec 00 must add its own test coverage for `timeoutMs`.**
Subspec 00 introduces `timeoutMs` as new transport behavior but scopes itself as move+rename and only lists preexisting tests as ACs — none of which exercise the new timeout-abandon path. Subspec 01 consumes `timeoutMs` but explicitly disclaims new tests ("exercised only through prober seams"), so the behavior would ship with no direct test anywhere. Subspec 00's task checklist/acceptance criteria must require a unit test (in the relocated transport's own test file) that directly covers: a request with `timeoutMs` set that times out gets abandoned and rejects with `RpcConnectionError`, and a request with `timeoutMs` set that resolves normally is unaffected.

**2. Subspec 00's Decisions must specify timer cleanup and the `trackWait`+`timeoutMs` interaction.**
The current decision bullet says timeout-abandon "reus[es] the existing `abandonRequest` path" but leaves two behaviors unstated: whether the timeout timer is cleared when the request resolves/rejects normally before the timeout fires (otherwise a dangling timer leaks or double-fires `abandonRequest`), and what happens when both `trackWait` and `timeoutMs` are set on the same request. This is shared infrastructure now consumed by three call sites — the interaction must be a stated decision, not left implicit. Add a ledger entry covering both.

**3. Subspec 02 must update `v2/docs/v1-behaviors.md`.**
Dropping `LOG_FRAME_WAIT_MS` (24h bound) in favor of unbounded `nextFrame()` is an observable behavior change: a hung daemon during `run log` previously errored out after 24h and now blocks forever. Per spec-guidance.md, any spec changing existing functionality must update `v1-behaviors.md` to record the new behavior. Subspec 02's "Documentation updates: None" is incorrect and must be replaced with a `v1-behaviors.md` update describing the change from bounded (24h) to unbounded wait on `run log`'s frame loop.

No other findings require refinement — the doc-formatting question raised about the `v2-architecture.md` IPC row is an execution detail for whoever completes subspec 00's checklist item, not a spec-level gap.