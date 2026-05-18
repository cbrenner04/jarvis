# Plan mode: configurable timestamp prefix and no-commit workflow

repo: cbrenner04/jarvis

- [ ] [00 - Config types, validation, and `resolvePlanFlags`](./00-config-types-and-resolve.md)
- [ ] [01 - Wire `specTimestamp` flag into plan directory naming](./01-spec-timestamp-flag.md)
- [ ] [02 - `commit: false` plan flow](./02-no-commit-plan-flow.md)
- [ ] [03 - `--resume` guard for no-commit specs](./03-resume-guard.md)

Subspecs 01 and 02 are independent of each other and may be parallelized once 00 is merged. Subspec 03 depends on 00 for the `commit` flag read but its structural check is otherwise independent; it may also be parallelized with 01 and 02 after 00 lands.
