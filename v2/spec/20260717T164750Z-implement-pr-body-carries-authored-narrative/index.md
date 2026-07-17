# v2 implement PR bodies carry an agent-authored narrative

repo: cbrenner04/jarvis

`prNarrative: "agent"` is declared but dead in v2: `pr-body-refresh.ts` preserves a
narrative marker block, yet nothing writes one, so every implement PR ships only the
templated `Spec:` header. Give the marker block a producer — the existing post-completion
shrink pass — and a sink that always round-trips.

- [x] [00 - refreshPrBody emits a supplied narrative in the marker block](./00-refresh-emits-narrative.md)
- [x] [01 - Shrink pass authors the implement PR narrative](./01-shrink-authors-narrative.md)
