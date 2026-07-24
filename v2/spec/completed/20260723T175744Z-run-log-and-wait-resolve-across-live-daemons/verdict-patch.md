Verifying test coverage and implementation against the spec before issuing the verdict.
## Verdict — required outcomes

1. **`run log` + missing run ID on every queried daemon**  
   Add a test that runs the full owner-resolution path (stubbed discovery and per-socket `list`, run absent everywhere), then opens the log stream on the invoking socket and exits **0** (e.g. empty stream / `stream-end`), consistent with the subspec acceptance item that pairs `unknown_run` for `run wait` with unchanged `run log` behavior. Today only `run wait` is covered via `runWait(..., [], [])`; there is no `run log` analogue.

2. **`run log` / `run wait` when no daemon is reachable**  
   Add tests that assert connection failures for `run log` and `run wait` still yield the same terse connection error and exit code as the pre-change single-socket path, with owner resolution enabled (stubbed discovery as needed). The acceptance criterion states that existing connection-error tests for these subcommands stay green; the suite only exercises `run list` for `connect ENOENT`, so the criterion is checked without enforcement. After this change, both commands may connect more than once before stream/`wait`; tests should lock in that operators still see the same failure surface when nothing is live.

**Rationale:** Core behavior and docs match the spec decisions (discovery ∪ invoking socket, skip failed lists, `mergeRunLists` / `isLive`, fallback to invoking socket, socket override on `withRunClient`). The gaps are **acceptance vs tests**, not spec deviation. Guard-inversion and cross-daemon happy-path tests are adequate for resolution wiring; the two items above close the remaining explicit acceptance wording.

**Not required for this pass:** exporting `resolveRunOwnerSocket`; syncing top-level `intent.md` checkboxes (process); stale-peer mis-route tests (shared with `run list` merge semantics); doc nits on default `list` vs `--since` or `daemon-host.md` fallback phrasing; describe-block naming. No change to production logic is mandated unless new tests expose a real bug.