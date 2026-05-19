# Cleanup spec shuffle

Make `jarvis cleanup` commit the spec-directory archive move it already
performs. The implementation should track the exact source and destination that
were moved into `spec/completed/` and commit only that path change.

- [ ] [00 - Commit cleanup spec archive move](./00-commit-cleanup-spec-archive-move.md)
