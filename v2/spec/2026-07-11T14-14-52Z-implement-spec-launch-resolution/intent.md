---
name: implement-spec-launch-resolution
---

# Resolve implement runs from their spec path

`jarvis run workflow implement --spec <path>` resolves its registered project from the spec path rather than the caller cwd.

When `--branch` is omitted, use the basename of the spec file's parent directory as the implementation branch. Preserve explicit `--branch`.

For an index spec, `--artifact` is ignored; document this v2 breaking CLI change. Non-index compatibility is deferred to the first caller that needs it.

## Decisions

- Project lookup walks from `--spec`, not cwd; rules out launching against an unrelated registered cwd.
- Omitted branch is the spec file parent's basename, not an arbitrary default; rules out collisions between spec runs.
- Deferred to first consumer: non-index `--artifact` compatibility — pin when a caller needs it.

## Documentation updates

- Update `v2/docs/write-behavior.md` with spec-path project resolution, branch derivation, and index-spec `--artifact` behavior.
- Update `v2/docs/first-workflow-walkthrough.md` to start implement without manual `--artifact`.

## Acceptance criteria

- [ ] An implement workflow launched from outside the project resolves the registered project containing `--spec`.
- [ ] An omitted branch equals the spec file parent's basename; an explicit branch remains unchanged.
- [ ] An index-spec launch no longer requires `--artifact` and documents that supplied value is ignored.
- [ ] CLI and workflow-step tests cover resolution, branch derivation, and the changed flags.

## Prerequisites

- Generic workflow launching is available.
- The `implement` preset exists.
