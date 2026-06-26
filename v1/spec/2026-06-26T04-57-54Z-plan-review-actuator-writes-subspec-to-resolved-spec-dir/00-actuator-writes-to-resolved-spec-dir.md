# Actuator overwrites draft subspec in resolved spec dir

## Problem

The plan review actuator pointed the agent at the bare spec-dir basename
(`<NAME>`) instead of the `targetDir`-prefixed path. The draft prompt anchors
writes with an explicit `- **Only write files under \`<targetDir>/<NAME>/\`.**`
rule; the actuator prompt has no such rule and its "Spec directory: `<NAME>`"
line carries only the basename. With the agent's cwd at the worktree root, the
actuator wrote refined subspecs to `<root>/<timestamp-name>/00-*.md` while the
resolved spec dir under `targetDir` kept the verdict-rejected draft. A later
`jarvis run` then read the stale draft. Observed 2026-06-25 on PR #549.

`buildVerdictActuatorPrompt` already does
`template.replaceAll("spec/<NAME>/", "${targetDir}/<NAME>/")`, but that only
rewrites the `spec/<NAME>/intent.md` prose reference — not the working/spec
directory lines that tell the agent where to write.

## Decisions

- Actuator write target is the same resolved spec dir the draft wrote: commit mode → `<worktree>/<targetDir>/<timestamp-name>/`; external no-commit → `specDirPath`. Rules out leaving the prompt's bare-basename path, which lands writes at the worktree root.
- Anchor the path in the actuator prompt itself (carry the full `targetDir`/spec-dir prefix on the working/spec-dir lines, mirroring draft), not by changing the agent cwd. Rules out repointing cwd, which would break the existing read-dir and intent.md path assumptions.
- Regression coverage drives a real single-subspec actuator pass with `specDirPath` unset (commit-mode path), since the existing tests pass `specDirPath` explicitly and bypass the basename-vs-prefix resolution where the bug lives.

## Task checklist

- Make the review actuator direct writes to the resolved spec dir with the full `targetDir` prefix, matching the draft phase.
- Add plan-side regression coverage: a single-subspec commit-mode review pass overwrites the draft subspec in place and creates no spec file outside the resolved spec dir.
- Update `v2/docs/v1-behaviors.md` actuator entry.

## Acceptance criteria

- [ ] In a single-subspec commit-mode plan (`specDirPath` unset), a review pass overwrites the draft subspec at `<targetDir>/<timestamp-name>/00-*.md` — the same path the draft wrote — replacing the verdict-rejected draft content.
- [ ] The same review pass creates no spec file outside the resolved spec dir; no `<worktree-root>/<timestamp-name>/` directory is produced.
- [ ] A new plan-side test exercises an actuator pass with `specDirPath` unset and a non-default `targetDir`, asserting both behaviors above.
- [ ] `v2/docs/v1-behaviors.md` records that the review actuator writes refined files to the resolved spec dir (full `targetDir` prefix), overwriting the draft in place.

## Documentation updates

- `v2/docs/v1-behaviors.md`: amend the plan-review actuator entry (the one stating the actuator "applies the verdict to `index.md`/subspec files under the existing plan write boundary") to record that writes land in the resolved spec dir with the full `targetDir` prefix, overwriting the draft subspec in place.
