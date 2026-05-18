# No-commit plan specs outside target repos

repo: cbrenner04/jarvis

- [ ] [00 - Store no-commit plan specs outside target repos](./00-no-commit-plan-storage.md)
- [ ] [01 - Run external local specs reliably in patch mode](./01-external-local-spec-run.md)
- [ ] [02 - Documentation and cleanup semantics](./02-docs-and-cleanup.md)

Subspec 00 changes where `jarvis plan` writes specs when the resolved plan
flag `commit` is `false`. Subspec 01 makes the resulting paths first-class
inputs to `jarvis run`. Subspec 02 documents the new contract and cleanup
behavior after the implementation shape is in place.
