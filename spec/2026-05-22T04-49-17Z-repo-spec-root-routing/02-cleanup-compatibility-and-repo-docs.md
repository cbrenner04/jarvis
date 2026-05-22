# 02 - Repo configuration, docs, and cleanup limitation

## Goal

Opt this repository into the new config-driven root, document the `targetDir`
config field for operators, keep generic guidance intact for ordinary target
repos, and record the cleanup limitation for plan trees created under a
non-default root such as `v1/spec/...`.

## Decisions

- This repository routes new committed plans to `v1/spec` by setting
  `projects.<jarvis>.plan.targetDir = "v1/spec"` on its project entry, not by any
  code-level detection. That setup step is part of this slice.
- Generic stable docs for external target repos keep describing the default
  in-repo layout as `spec/<timestamp>-<slug>/`, since the default `targetDir`
  remains `"spec"`. They should mention `targetDir` as the override knob without
  implying other repos must change it.
- Repo-specific guidance in this repository points new work at `v1/spec/` and
  reserves `v2/spec/` for future explicit workflows.
- Because the root is configured rather than cwd-derived, there is no
  requirement to run `jarvis plan` from `v1/`; docs must not introduce such a
  requirement.
- Cleanup/archive support for non-default roots (e.g. `v1/spec/...`) is an
  intentional non-goal here. Existing cleanup behavior over root `spec/...` and
  `spec/completed/...` is left untouched, and a later spec can teach cleanup
  about configured roots.
- Docs must not imply `jarvis1 cleanup` will archive plan trees created under a
  configured non-default root.
- Historical root-level `spec/...` trees in this repository remain safe to leave
  in place.

## Task Checklist

- Set `projects.<jarvis>.plan.targetDir = "v1/spec"` for this repository's
  registered project entry, and document how an operator does the same.
- Document the `targetDir` config key for operators: global `modes.plan` default
  vs per-project override, the explicit `"spec"` default, and the relative-path
  constraint.
- Update repo-owned docs/examples that describe creating specs for this
  repository so they use `v1/spec/...` and reference the config setting.
- Update repo-specific examples for `jarvis1 plan`, `jarvis1 plan --resume`, and
  post-merge `jarvis1 run` only where they are about this repository's layout.
- Preserve generic docs for ordinary target repos (default `spec/`).
- Audit cleanup/archive docs for assumptions that new plan trees are always
  archived from root `spec/...`, and document the non-goal for configured roots.
- Add coverage only if this slice changes user-visible text already asserted in
  tests.

## Acceptance criteria

- [x] This repository's registered project config sets
      `plan.targetDir = "v1/spec"`, and the docs show operators how to set
      `targetDir`.
- [x] Repository-specific guidance for creating or resuming new Jarvis specs
      points to `v1/spec/<spec-dir>/...`.
- [x] Generic docs for normal target repos still describe committed in-repo
      specs under `spec/<timestamp>-<slug>/`, with `targetDir` documented as an
      optional override.
- [x] The docs explicitly state that this change does not teach `jarvis1 cleanup`
      to archive plan trees created under a configured non-default root.
- [x] Docs do not introduce a requirement to run plan mode from `v1/`.
- [x] Historical root-level `spec/...` trees in this repository do not require
      migration.
- [x] No cleanup/archive code changes are required to complete this spec.

## Documentation updates

- Update repo-specific docs that currently teach root-level `spec/` for
  Jarvis-owned work, add operator documentation for the `targetDir` config key,
  and update cleanup/workflow docs to record the non-goal for configured roots
  without overfitting generic target-repo guidance to this repo.

## Manual setup after merge

After this PR is merged, manually apply the configuration to `~/.jarvis/config.json`:

```json
{
  "projects": {
    "jarvis": {
      "plan": {
        "targetDir": "v1/spec"
      }
    }
  }
}
```

This can be done by editing `~/.jarvis/config.json` directly or using `jarvis1 config edit`.
Verify with: `jarvis1 config show | jq '.projects.jarvis.plan.targetDir'` should output `"v1/spec"`.
