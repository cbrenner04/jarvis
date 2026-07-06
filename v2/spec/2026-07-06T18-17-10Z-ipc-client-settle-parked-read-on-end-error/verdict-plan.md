## Verdict

**1. Test mechanism for genuine `'end'`/`'error'` events is unspecified and currently unbuildable — must be fixed.**

`connectIpcClient()` exposes only `{send, nextFrame, close}`; there is no accessor for the underlying socket. The existing `'close'` test drives closure via `client.close()` → `socket.destroy()` on the client's own socket, which only ever produces `'close'` — it cannot generate a genuine `'end'` (half-close) or `'error'` (RST) from the client side, and `startIpcServer` does not expose the per-connection server-side socket to test code. As written, the spec's acceptance criteria for `'end'` and `'error'` are not verifiable with any existing seam.

The spec must specify how these two tests will drive real `'end'`/`'error'` events — e.g., a minimal test-only raw server (a bare `net.createServer` the client connects to directly, bypassing `startIpcServer`, mirroring how `connectRaw()` bypasses `IpcClient` in the other direction) that can call `socket.end()` for `'end'` and `socket.resetAndDestroy()` (or equivalent) for `'error'` on the accepted connection. Without naming this mechanism (or an equivalent), the acceptance criteria are unimplementable as stated.

**2. Missing test/criterion for the "no settlement on mere silence" invariant — must be added.**

The intent states this as a hard constraint ("Must not break long-quiet tailing: settle only on real disconnect, never on mere silence"), and the spec's Decisions section asserts it, but no test or acceptance criterion verifies it. Add an acceptance criterion covering: an unbounded `nextFrame()` remains pending after a period of socket inactivity (no `'end'`/`'close'`/`'error'`), and only settles once a real disconnect event fires. This is required because the intent names it explicitly as a constraint the spec must test, not just assert.

**Not required (raised but correctly out of scope or non-blocking):**
- A bounded-timer variant of the `'end'`/`'error'` tests is redundant given the shared-settlement-function design and the existing bounded `'close'` coverage — not required.
- Dropping the underlying `Error` object on `'error'` in favor of the existing `"connection closed"` rejection message is a deliberate, in-scope-consistent choice (no current caller branches on error content) — not a defect.
- The unguarded `send()` after half-close is a real edge case but concerns write behavior, not parked-read settlement, and is explicitly excluded by the intent's "no protocol/framing changes" scope — leave out, better suited to a separate follow-up.