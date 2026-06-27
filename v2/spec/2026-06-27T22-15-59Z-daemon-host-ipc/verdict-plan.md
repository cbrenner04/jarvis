## Verdict: required refinements

### `00-ipc-transport` — wire contract

1. **Pin minimal envelope field shapes** for `request`, `response`, and `error` frames (e.g. which fields carry `method`, params, result, code/message) in acceptance criteria and the `daemon-host.md` doc task. The `kind` union and correlation-by-`id` are insufficient — two implementations could both pass today’s ACs with incompatible payloads.

2. **Make malformed-frame handling deterministic per failure class.** Framing failures (bad length, truncated body, invalid JSON) and semantic failures (valid JSON but bad/missing `kind`, unknown `method`) must each have one specified outcome in ACs — not “close **or** error.”

3. **Pin one observable streaming-handler contract** for this slice (e.g. echo chunks, or accumulate until `stream-end`). Add ACs that RPC round-trips succeed while a stream is open and that stream lifecycle does not break request/response correlation. “Echo or buffer” is not testable.

4. **Reconcile default socket bind wording with deferral.** Decisions defer the default filename; tasks say “bind under `~/.jarvis` by default” while ACs only require caller-supplied paths. Pick one: require explicit `socketPath` everywhere until CLI pins the default, or name a provisional constant with an inline deferral note — and remove conflicting “by default” language elsewhere.

5. **Clarify concurrent connections.** Decisions defer max clients, but the spec must state that multiple simultaneous connections are accepted (no admission cap yet), so implementers do not read “one connection per client” as single-client-only.

6. **Document IPC `status` semantics** in `daemon-host.md`: daemon-host liveness (`{ state: "running" }`), distinct from future run-orchestration status. Note rename collision risk for the run-control sibling if useful; no new run-control verbs here.

### `01-daemon-lifecycle` — lifecycle and ownership

7. **Replace `stopDaemon` AC language** referencing “configured recovery deferral.” Stale-socket recovery on crash is deferred; the AC should require observable post-stop outcomes only (socket unbound, `getDaemonStatus` → `stopped`).

8. **Pin double-start behavior** when the configured socket already answers `health`: second `startDaemon` must either fail or return idempotently — pick one. Crash/orphan recovery stays deferred.

9. **Pin a testable graceful-shutdown baseline:** shutdown signal, reject new connections after shutdown begins, drain in-flight IPC, bounded wait with forced exit on hang. Enough that integration tests cannot block forever.

10. **Pin `getDaemonStatus` probe order:** process liveness first, then short-timeout `health`; any failure → `stopped` (covers liveness/transport races).

11. **Pin `startDaemon` failure mode:** bounded wait for transport readiness; throw (no silent success) if `health` never succeeds.

12. **Align detached-process testing with `v2/docs/test-writing.md`.** Real detached-child integration coverage must live in `*.sandbox-unrunnable.test.ts` (with top comment); ACs should cite that file explicitly. Agent-runnable tests may cover DI seams for start/stop/status logic.

13. **Tie ownership registry to the daemon host.** Add AC that the daemon entrypoint constructs/holds the in-memory registry (IPC exposure not required). Architecture says the daemon tracks ownership — a freestanding library alone does not satisfy that.

14. **Pin ownership error semantics in ACs:** second `claim` on the same `(project, branch)` rejects with a typed error; `release` on an unheld key is a no-op.

15. **Align `(project, branch)` key types** with existing state-store resume keys (`project: string`, `branch: string`) — do not invent alternate key semantics.

16. **Reconcile PID-file mentions** in tasks/decisions: either defer default PID path entirely (tests use injected paths only) or pin test-only semantics without a production default.

17. **Fix preservation AC citations:** keep `write-loop.test.ts` and `shared/worktree-lock.test.ts` as primary agent-runnable pins; drop or qualify `external-worktree.sandbox-unrunnable.test.ts` as operator-suite-only (sandbox agents may not run it).

### Intent and documentation

18. **Add intent `## Prerequisites`:** Phase 2 write loop + state store merged. Empty prerequisites skip plan-mode validation for work that sits in that sequence; this slice does not invoke them but depends on that foundation being landed.

19. **Extend intent documentation updates** to include `v2/docs/daemon-host.md` (component contract home per `documentation-standard.md`), not only `v2-architecture.md`.

20. **Accept sequential doc ownership** (`00` = wire contract in `daemon-host.md`; `01` = lifecycle, ownership, architecture Interface reconcile) — no change required unless `00` adds a minimal architecture cross-link; either is fine if the split is explicit.

### Rationale (cross-cutting)

These refinements close gaps where current ACs permit incompatible implementations, reference deferred behavior, or contradict repo conventions (`test-writing.md`, preservation-AC citation pattern, documentation placement). They preserve defended scope: hermetic UDS, transport-before-lifecycle sequencing, `.jarvis.lock` / `executeWriteLoop` untouched, run-control verbs deferred, crash/stale-socket recovery deferred to CLI consumer.

### Not required

- Splitting lifecycle and ownership into separate subspecs (bundling remains defensible at this size).
- Protocol version field or run-control method names (correctly deferred to first consumer).
- Replacing IPC `status` stub with run-orchestration semantics in this spec.
