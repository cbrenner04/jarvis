# Pipeline stage re-dispatch continues a clean committed lane when base moves

Chained implement `pipeline resume` hits the same `maybeResetStaleWorkspace` → `resetStaleWorkspace` preflight as standalone re-run; today `trackableSpecPath` is cleared for out-of-root stage specs, so moved-base lanes refuse before rebase.

- [ ] [00 — Continuation-readable spec and out-of-root rebase](00-continuation-readable-out-of-root-rebase.md)
- [ ] [01 — Merge base into lane when open PR and moved base](01-merge-when-open-pr-moved-base.md)
