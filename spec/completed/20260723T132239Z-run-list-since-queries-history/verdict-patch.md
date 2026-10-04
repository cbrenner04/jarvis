## Verdict

### Required outcomes

1. **`daemon-host.md` § Terminal run list retention must document `sinceMs` history queries.** The RPC table already says filtered `list` bypasses terminal retention when `sinceMs` is present, but the dedicated retention section still describes only the default fifty-newest bound and invocation-sibling retention. An operator reading that section alone will miss how history queries behave. Align it with the subspec’s documentation requirement (`daemon-host.md` — optional `sinceMs`; filtered queries bypass terminal retention) by stating that when `sinceMs` is set, the fifty-newest terminal cap and sibling retention are skipped, rows match `created_at >= sinceMs` in store order (`created_at DESC`, `rowid DESC`), and durable rows are still not deleted.

### Rationale

The implementation matches the completed subspec and acceptance criteria: CLI-side `--since` parsing, `invalid_since` on bad values before RPC, retention bypass in the daemon, tests past the fifty-run window, and log/tail stream-open for returned IDs. Unbounded filtered scans, Unix-seconds ambiguity, workflow snapshot fragmentation, daemon param validation, parser extensibility, and loose `Date.parse` are acknowledged risks or follow-ups, not spec violations for this slice.

The retention-section doc gap is the only upheld issue that blocks merge readiness: operator-facing semantics changed, the subspec names `daemon-host.md` as a doc home, and the RPC one-liner alone does not satisfy the placement policy for that behavior.
