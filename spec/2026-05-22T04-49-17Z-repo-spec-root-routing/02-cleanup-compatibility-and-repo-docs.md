# 02 - Cleanup compatibility and repo-specific docs

## Goal

Close the remaining gaps created by moving new Jarvis-repo committed plans to
`v1/spec/...`: cleanup/archive behavior and documentation that talks about this
repository's own spec layout. This slice should either extend the shared
committed-spec-root logic into cleanup or make any intentional non-goal
explicit so operators are not left with a half-migrated workflow.

## Decisions

- Generic stable documentation for external target repos should keep describing
  the default in-repo layout as `spec/<timestamp>-<slug>/` unless the text is
  specifically about the Jarvis repository itself.
- Repo-specific guidance in this repository should point new work at `v1/spec/`
  and reserve `v2/spec/` for future explicit workflows.
- Cleanup behavior needs an explicit answer in this spec: either update it to
  understand the Jarvis-repo committed-spec root for new plans, or document the
  limitation as an intentional follow-up with no ambiguity for operators.
- Historical root-level `spec/...` trees in this repository must remain safe to
  leave in place.

## Task Checklist

- Audit cleanup/archive code and docs for assumptions that only committed
  `spec/<spec-dir>` trees exist.
- If feasible within this spec, route cleanup/archive lookup for this
  repository through the same committed-spec-root source of truth so new
  `v1/spec/...` plans are archived consistently.
- If cleanup is intentionally deferred, document the limitation in both the
  implementation notes and user-facing docs, and make sure new-path docs do not
  imply behavior that cleanup does not provide.
- Update repo-owned docs and examples that describe creating specs for this
  repository so they use `v1/spec/...` instead of root `spec/...`.
- Preserve generic docs for ordinary target repos unless the page is explicitly
  describing work on the Jarvis repo.
- Add regression coverage for any cleanup or archive behavior changed here.

## Acceptance criteria

- [ ] Repository-specific guidance for creating or resuming new Jarvis specs
      points to `v1/spec/<spec-dir>/...`, not root `spec/<spec-dir>/...`.
- [ ] Generic docs for normal target repos still describe committed in-repo
      specs under `spec/<timestamp>-<slug>/` unless they are explicitly about
      the Jarvis repository.
- [ ] Cleanup/archive behavior for new Jarvis-repo committed plans is either
      updated to handle `v1/spec/...` or explicitly documented as a non-goal of
      this change with clear operator-facing guidance.
- [ ] Historical root-level `spec/...` trees in this repository do not require
      migration as part of this work.
- [ ] Any cleanup or archive logic changed for the new routed path has
      automated coverage.

## Documentation updates

- Update the repo-specific docs that currently teach root-level `spec/` for
  Jarvis-owned work, and update cleanup or workflow docs as needed to match the
  final scope decision for `v1/spec/...`.
