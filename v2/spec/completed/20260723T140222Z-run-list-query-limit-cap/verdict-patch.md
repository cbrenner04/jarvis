Reviewing implementation and docs against the spec to issue an outcome-focused verdict.
## Required outcomes

1. **`daemon-host.md` — filtered-path wording**  
   In § Terminal run list retention, describe the bypass-retention / newest-first / cap path in terms of **any set list filter field** (today `sinceMs`), matching the `list` RPC table. The subsection must not read as if only `sinceMs` enables that path, or it will drift from the table and from future dimension filters named in the spec.

2. **`operator-runbook.md` — bare `--limit`**  
   Where bare `jarvis run list --limit <n>` is documented, state plainly that **without a filter the daemon does not use `limit` to reduce rows**: row count and retention match plain `jarvis run list` (fifty-newest terminal policy). Passing `limit` on the RPC is intentional; ignoring it on the retention path is the behavior under test in acceptance.

3. **`write-behavior.md` — same bare `--limit` semantics**  
   The `run list` table entry must not imply that bare `--limit` truncates output. Align with (2): retention path only; `limit` has no effect on row count until a filter field is present.

4. **Operator-facing **200** cap and multi-daemon merge**  
   Where docs say filtered queries default to **200** newest matches (`operator-runbook.md` Observe prose and/or `v1-behaviors.md`), note that **200 is applied per keyed daemon `list` response before** `jarvis run list` merges sockets. Merged CLI output can exceed 200 when multiple live daemons each return matches.  
   **Rationale:** v2 already merges without a post-merge cap; this change makes **200** prominent. Without the qualifier, operators can read “200 matches” as a global bound.

---

**Not required for this patch (no actuator action):** daemon-side validation of `limit` on the filtered RPC path (acceptance pins `invalid_limit` on CLI only); rejecting duplicate `--since`/`--limit`; stricter integer parsing; stronger newest-first assertions in tests; moving `run-list-rpc` out of `commands/`; capping explicit `--limit`; store-scan optimization; workflow rollup cost. Behavior matches the subspec: filter → cap (explicit or 200) → assembly on the filtered path; retention path when only `limit` is set; centralized predicate and tests as specified.