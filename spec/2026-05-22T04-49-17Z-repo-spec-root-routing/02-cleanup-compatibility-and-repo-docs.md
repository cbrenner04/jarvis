# 02 - Repo docs and explicit cleanup non-goal

## Goal

Finish the repo-facing guidance for the new Jarvis-specific spec location and
make the cleanup/archive boundary explicit. This slice does not add a second
implementation project for cleanup routing; it documents the operator-visible
consequences of moving new Jarvis-repo committed plans to `v1/spec/...`.

## Decisions

- Generic stable documentation for external target repos should keep describing
  the default in-repo layout as `spec/<timestamp>-<slug>/` unless the text is
  specifically about the Jarvis repository itself.
- Repo-specific guidance in this repository should point new work at `v1/spec/`
  and reserve `v2/spec/` for future explicit workflows.
- Cleanup/archive support for `v1/spec/...` is an intentional non-goal of this
  change. Existing cleanup behavior that reasons about root `spec/...` and
  `spec/completed/...` is left untouched here.
- Because cleanup stays unchanged, docs must not imply that `jarvis1 cleanup`
  will archive new Jarvis-repo plan trees created under `v1/spec/...`.
- Any later work that teaches cleanup about `v1/spec/...` should be handled in
  a separate spec so this routing change stays reviewable.
- Historical root-level `spec/...` trees in this repository must remain safe to
  leave in place.

## Task Checklist

- Audit cleanup/archive docs and workflow text for assumptions that new
  committed plan trees will always be archived from root `spec/...`.
- Document the cleanup limitation in user-facing docs and any implementation
  notes that describe the new `v1/spec/...` location.
- Update repo-owned docs and examples that describe creating specs for this
  repository so they use `v1/spec/...` instead of root `spec/...`.
- Preserve generic docs for ordinary target repos unless the page is explicitly
  describing work on the Jarvis repo.
- Add coverage only if this slice changes any user-visible text that is already
  asserted in tests.

## Acceptance criteria

- [ ] Repository-specific guidance for creating or resuming new Jarvis specs
      points to `v1/spec/<spec-dir>/...`, not root `spec/<spec-dir>/...`.
- [ ] Generic docs for normal target repos still describe committed in-repo
      specs under `spec/<timestamp>-<slug>/` unless they are explicitly about
      the Jarvis repository.
- [ ] The docs explicitly state that this change does not teach `jarvis1 cleanup`
      to archive new Jarvis-repo plan trees under `v1/spec/...`.
- [ ] Historical root-level `spec/...` trees in this repository do not require
      migration as part of this work.
- [ ] No cleanup/archive code changes are required to complete this spec.

## Documentation updates

- Update the repo-specific docs that currently teach root-level `spec/` for
  Jarvis-owned work, and update cleanup/workflow docs as needed to reflect the
  explicit non-goal for `v1/spec/...` archival.
