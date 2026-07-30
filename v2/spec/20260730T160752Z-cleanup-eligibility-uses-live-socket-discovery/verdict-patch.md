Verifying the advocate's central claim about test fixtures and whether production code matches the spec.
## Verdict: required outcomes before merge

### 1. Slice regression tests must prove live-run blocking, not only multi-socket reachability

The primary acceptance criteria require that a live run reported by an older-digest (or surviving peer) daemon makes the worktree ineligible, and that the CLI path suppresses no-listener stderr **while** honoring that live run.

Current IPC fixtures pass `staleResetPreflight: { listRuns: [] }` into `makeIpcClient`, which answers every `list` with an empty run set before queued live-run frames run. Eligibility therefore never sees `isLive: true`.

Assertions in `older-digest live daemon makes merged worktree ineligible`, `one dead socket in query set does not blank eligibility when another reports live run`, and `discovered older-digest daemon suppresses no-listener stderr and blocks live run` only check absence of `Daemon unreachable` / `Skipped merged worktree`, exit `0`, and worktree still on disk after dry-run. Those outcomes are equally true when the daemon is reachable with no live run (worktree eligible) and when a live run blocks retirement (silent ineligibility). The tests do not distinguish the spec’s required behavior.

**Required:** Fix fixtures so `list` responses deliver the intended live runs for bulk-cleanup paths that do not use claim preflight. Add positive assertions that the worktree is withheld because of a live run (e.g. excluded from the eligible preview set, or an explicit live-run ineligibility signal)—not only that daemon-unreachable skip text is absent.

**Why:** Without this, checked acceptance criteria for live-run honor are false confidence; guard-inversion RED only pins adjacent wiring (discovery union, connect skip), not `isLive` union on the happy path.

---

### 2. Add coverage for invoking-socket hard error when another socket answers

The spec and runbook decide that connect failures on the invoking socket (`EACCES`, timeout, etc.) must not abort bulk cleanup when another socket in the query set answers. CLI wiring gates abort on `!hasAnsweringDaemon && firstError && !isNoListenerError(firstError)`.

**Required:** A test that an invoking-socket hard error plus an answering discovered peer continues cleanup and does not emit the connection-abort path or the true no-listener stderr.

**Why:** This is an explicit operator-visible decision with no regression test; a wiring mistake would abort cleanup despite a healthy older-digest daemon.

---

### Not required for this pass

Production wiring aligns with the spec: shared socket set and query loop, `mergeRunLists` + `isLive` union, per-socket skip-on-failure, stderr gated on answering daemons, `--abandon`/claim paths keyed-only, docs updated. No actuator action needed for: RpcError/malformed-parse skip beyond connect (shared with `run list`), bulk-factory recheck wiring (preservation tests cover recheck via shared client), stderr snapshot vs re-query race, performance of per-probe re-list, dead `createAbsentDaemonClient`, or stale `intent.md` checkboxes.