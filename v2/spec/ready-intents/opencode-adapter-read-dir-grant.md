---
name: opencode-adapter-read-dir-grant
---

# opencode adapter accepts a target-repo read-dir grant

## Problem

The opencode adapter passes no read-dir flag: `runOpencodeBinding` argv is only `run --dir --model --format json` (`shared/invocation/agents.ts:1282`) and it does not thread `additionalReadDirs` the way the claude/codex adapters do via `appendAdditionalReadDirFlags` (`agents.ts:408`). So any external invocation routed through opencode — including external plan draft — silently drafts with no read grant to the target-repo read root, while `v2/docs/v1-behaviors.md:114` still records opencode/cursor read-dir parity as "deferred until a production consumer". External plan draft is now that consumer.

## Decisions

- The opencode binding accepts `additionalReadDirs` and emits a read-dir expression equivalent to claude's `--add-dir` (or opencode's nearest mechanism), so a caller granting a read root reaches the agent instead of being dropped.
- claude/codex read-dir behavior is unchanged; only opencode gains the parity it lacked.

## Prerequisites

## Acceptance criteria

- [ ] A test asserts the opencode adapter emits a target-repo read-dir grant in its argv when `additionalReadDirs` is supplied; it fails against the current `runOpencodeBinding` argv that carries no read-dir flag.
- [ ] A test asserts opencode omits the read-dir expression when no `additionalReadDirs` is supplied; it fails against any implementation that unconditionally emits the flag.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2`, and `bun run test:shared` pass.

## Documentation updates

- `v2/docs/agent-model-config.md` — per-vendor read-dir grant now includes opencode.
- `v2/docs/v1-behaviors.md` — update the deferred-parity note: opencode (and cursor) now receive the read grant.
