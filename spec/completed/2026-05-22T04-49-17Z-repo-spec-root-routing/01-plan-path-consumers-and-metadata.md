# 01 - Plan path consumers and metadata

## Goal

Make every committed-plan consumer that formats or constrains spec-relative
paths for new plans use the same resolved `targetDir` from subspec 00, instead
of a hard-coded `spec/<spec-dir>/...` literal. Keep parsers that read existing
commit bodies permissive so legacy `spec/...` history stays valid.

## Decisions

- Path formatting for new committed plans is part of the same behavior as the
  path resolution in subspec 00; commit bodies and PR text must use the resolved
  `targetDir`, not an independent `spec/...` literal.
- The shared formatter emits the actual committed spec path for the active tree.
  For new plans that is `<targetDir>/<spec-dir>/...`; for a resumed legacy tree
  it is the real on-disk path that resume already resolved.
- Parsers that consume existing `Spec:` commit bodies or resume paths stay
  permissive about the root. Existing `Spec: spec/...` bodies remain valid
  historical data; this change does not rewrite history.
- PR rendering and meta-commit grouping that currently match `Spec: spec/...`
  must recognize any committed root, so both default `spec/...` repos and a
  configured `v1/spec/...` repo render correctly.
- Callers that receive an explicit committed spec path (resume or
  `--resume-draft`) preserve that path identity through user-facing text,
  write-boundary checks, and commit metadata rather than canonicalizing it to
  the configured root.
- Patch-mode spec handling is out of scope unless a concrete reader breaks when
  pointed at a non-`spec/` root.

## Task Checklist

- Replace hard-coded committed-plan path strings in CLI usage, next-step
  commands, resume guidance, and blocker text with output derived from the
  resolved `targetDir`.
- Route write-boundary enforcement and boundary blocker messaging through the
  resolved committed root instead of a literal `spec/<spec-dir>/` prefix.
- Update plan-phase prompt templates so committed draft and review prompts tell
  agents to write under the resolved root.
- Update plan commit-body `Spec:` markers (`commits.ts`) to use the resolved
  committed path.
- Update PR rendering / meta-commit grouping (`pr.ts`) so the `Spec:` matcher
  and the body header links work for any committed root.
- Ensure the `Spec:` parser stays permissive so historical `spec/...` bodies and
  resumed legacy trees still parse and render.
- Add regression coverage for the formatting and parser surfaces that consume
  committed-plan paths.

## Acceptance criteria

- [x] Human-facing committed-plan output uses the resolved `targetDir` (e.g.
      `v1/spec/<spec-dir>/...` for a repo configured that way, `spec/<spec-dir>/`
      for a default repo).
- [x] Plan draft/review prompts, write-boundary enforcement, and boundary
      blocker text all target the resolved committed root.
- [x] Plan meta-commit bodies emit `Spec: <resolved-committed-path>/intent.md`.
- [x] PR metadata/attribution that parses committed plan `Spec:` lines
      recognizes both default `spec/...` plans and a configured `v1/spec/...`
      plan.
- [x] Existing historical plan commits containing `Spec: spec/...` remain
      renderable without migration or history edits.
- [x] Resume, `--resume-draft`, and next-step commands printed for a new plan in
      a configured-root repo reference the resolved `targetDir` path.
- [x] Resume, `--resume-draft`, boundary enforcement, and follow-up commit
      metadata for a legacy root-level `spec/<spec-dir>/...` tree continue to
      reference that real legacy path rather than rewriting it to the configured
      root.
- [x] Automated coverage proves the path-consuming surfaces use the shared
      resolved value rather than each caller carrying its own prefix.

## Documentation updates

- Update operator-facing plan-mode docs that describe committed plan paths,
  resume commands, write-boundary behavior, and plan PR metadata where they
  depend on the committed root, including the legacy-root resume behavior.
