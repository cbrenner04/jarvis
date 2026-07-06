---
name: v2-trust-daemon-wire
---

# Trust daemon responses at clients

Client code re-validates every RPC payload from our own daemon — same binary, same machine, unix socket. Replace per-field validation with a thin envelope check; one real-socket smoke is the integration proof. Operator-decided.

## Decisions

- Trust direction is **client ← daemon responses only**. The daemon keeps validating incoming client params (it owns durable state).
- `daemon-wire.ts`: reduce per-field payload validators to a thin shape check (frame kind/id envelope + result object presence); typed results come from the shared response types, not runtime re-validation.
- `tui-daemon-client.ts`: remove the `parseOrThrow` wrappers. `tui-log-tail-client.ts`: replace field-by-field `PersistedRecord` validation with the envelope check. cli.ts: same treatment where it re-checks response fields.
- Tests: `daemon-wire.test.ts` shrinks to envelope-level cases; delete the malformed-payload sections of `tui-daemon-client.test.ts` and cli.test.ts that fabricate impossible daemon responses.
- **One integration smoke:** extend `daemon.sandbox-unrunnable.test.ts` with a single start→list round trip over the real socket, proving real daemon responses flow through the thin checks end-to-end. No new test file.
- Docs: record the trust decision in `v2-architecture.md` (Interface & IPC) so future clients don't reintroduce validators.

## Out of scope

- Wire schema/protocol changes, versioning, handshakes.
- Server-side request validation.

## Ordering

04 — after 03; before 07 (the implement preset extends the wire — new fields should not pay per-field client validators).
