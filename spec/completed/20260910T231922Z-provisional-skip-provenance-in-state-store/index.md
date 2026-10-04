---
name: provisional-skip-provenance-in-state-store
---

# `skipped` stage rows record whether the skip was provisional or terminal

`skipped` is one opaque status: suffix rows skipped after a predecessor failure (undone work) are indistinguishable from `default` rows a fan-out split retires as never-applicable. Record the provenance at write time, then expose a branch-scoped reopen of provisional skips that needs no `failed` anchor.

- [x] [00-record-skip-provenance.md](./00-record-skip-provenance.md) — stage rows record provisional vs terminal skip provenance at write time
- [x] [01-reopen-provisional-skips.md](./01-reopen-provisional-skips.md) — branch-scoped reopen of provisional `skipped` rows to `pending`
