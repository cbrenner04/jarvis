# 01 - Plan path consumers and metadata

## Goal

Make every committed-plan consumer that formats, validates, or constrains
spec-relative paths use the same resolved committed-spec root as subspec 00.
This covers the current family of hard-coded `spec/<spec-dir>/...` assumptions
across boundary enforcement, resume/help text, commit metadata, PR rendering,
and plan prompts.

## Decisions

- Path formatting for committed plans is part of the same behavior as path
  resolution; commit bodies and PR text must not keep an independent
  `spec/...` convention.
- The shared formatter must still emit `spec/...` for generic repos and
  `v1/spec/...` for new Jarvis-repo committed plans.
- Compatibility for historical Jarvis-repo root `spec/...` plan trees must be
  explicit where parsers consume existing commit bodies or resume paths.
- Existing `Spec: spec/...` commit bodies remain valid historical data; this
  change extends parsers and renderers to understand `v1/spec/...`, not by
  rewriting old commit history.
- Patch-mode spec handling is out of scope unless a concrete reader breaks when
  pointed at `v1/spec/...`.

## Task Checklist

- Replace hard-coded committed-plan path strings in CLI usage, next-step
  commands, resume guidance, and blocker text with output from the committed
  spec-root formatter or policy introduced in subspec 00.
- Route write-boundary enforcement and boundary blocker messaging through the
  resolved committed-spec root instead of a literal `spec/<spec-dir>/` prefix.
- Update plan-phase prompt templates or prompt rewriting so committed draft and
  review prompts tell agents to write under the correct repo-local path.
- Update plan commit-body `Spec:` markers to use the resolved committed spec
  path and keep downstream parsing working.
- Update PR rendering or meta-commit grouping that currently recognizes only
  `Spec: spec/...` lines so it continues to work for both generic repos and
  Jarvis-repo `v1/spec/...` plans.
- Ensure new-path metadata surfaces and legacy-path parsers share one path
  formatter/parser contract rather than each caller carrying its own regex or
  prefix logic.
- Add regression coverage for the formatting and parser surfaces that consume
  committed-plan paths.

## Acceptance criteria

- [ ] Human-facing committed-plan output uses `v1/spec/<spec-dir>/...` for this
      repository and still uses `spec/<spec-dir>/...` for ordinary repos.
- [ ] Plan draft or review prompts, write-boundary enforcement, and boundary
      blocker text all target the same resolved committed spec root.
- [ ] Plan meta-commit bodies use `Spec: <resolved-committed-spec-path>/intent.md`
      instead of a hard-coded `Spec: spec/...` line.
- [ ] PR metadata or attribution logic that parses committed plan `Spec:` lines
      continues to recognize both generic `spec/...` plans and Jarvis-repo
      `v1/spec/...` plans.
- [ ] Existing historical plan commits in this repository that already contain
      `Spec: spec/...` remain renderable without migration or history edits.
- [ ] Resume, `--resume-draft`, and next-step commands printed for new
      Jarvis-repo plans reference `v1/spec/...` paths.
- [ ] Automated coverage proves the shared formatter is used by path-consuming
      plan metadata surfaces rather than each caller carrying its own prefix.

## Documentation updates

- Update the operator-facing plan-mode docs that describe committed plan paths,
  resume commands, write-boundary behavior, and plan PR metadata where they are
  specific to this repository or to the shared committed-spec formatting rule.
