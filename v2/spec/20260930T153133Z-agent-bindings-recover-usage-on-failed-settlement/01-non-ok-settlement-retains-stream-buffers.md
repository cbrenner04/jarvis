# 01 — Non-ok settlement retains stream buffers for usage recovery

`settleAbort` and several pinned non-ok settlements omit the retained NDJSON stream buffers that `ok` finalize parses (`claude abort returns terminal error`, cursor/codex abort parity), so finalize-only recovery cannot attach usage on abort or other paths that never carry parseable bytes on the settled result.

## Decisions

- Extend `runAgent` settlement so abort, stall, idle stall, quota, error, and model_config carry the same parseable stream retention the binding would use on `ok` (claude stream-json on `stdout` or quota `stderr: outBuf`; cursor/opencode excluded stdout on `diagnostics` via `retainedDiagnosticsSpread`; stall combined `errBuf+outBuf` on `stderr`) — rules out finalize reading buffers that settlement never attached.
- Abort settlements retain stream bytes without changing `kind`, exit code, or abort `stderr` prefix semantics beyond adding optional `stdout` / `diagnostics` fields — rules out reclassifying abort to `ok`.
- Update pinned abort expectations in `agents.test.ts` rather than weakening them — rules out leaving abort without retained streams once recovery is in scope.

## Tasks

- Centralize retention spreading for `settleAbort`, forced-result settle, and any non-ok path still missing `diagnostics` / claude-style `stdout` where the stream exists in `outBuf` / `errBuf`.
- Extend `agents.test.ts`: abort after partial claude/cursor/opencode stream-json; idle stall and model_config fixtures assert retained buffers; stream-backed quota on cursor (and claude zero-exit quota envelope) assert buffers reachable for finalize parsers.
- Run `bun run typecheck`, `bun run test:shared`, and `bun run test:integration:shared`.

## Acceptance criteria

- [ ] `agents.test.ts` — claude abort after partial stream-json retains parseable NDJSON on the settled `error` (via `stdout` or documented claude retention field); fails against pre-fix `settleAbort` that omits stream bytes (`claude abort returns terminal error and kills the child` constructible on main).
- [ ] `agents.test.ts` — cursor and codex abort after partial stream retain the same class of buffers as non-abort error/quota paths (`diagnostics` / scoped stdout rules); fails against pre-fix abort shapes in `cursor binding invokes the CLI shape…` and `codex binding invokes the CLI shape…`.
- [ ] `agents.test.ts` — idle stall and `model_config` settlements with buffered NDJSON retain streams on the settled result for finalize input; fails against pre-fix results that drop `outBuf` on those kinds.
- [ ] `agents.test.ts` — stream-backed quota (cursor quota pattern and claude zero-exit quota envelope) retains NDJSON where finalize must read outside `ok.stdout`; fails against mocks that only attach usage to `ok`.
- [ ] `bun run typecheck`, `bun run test:shared`, and `bun run test:integration:shared` pass.

## Documentation updates

- None (settlement retention only; adapter recovery documented in subspec 02).
