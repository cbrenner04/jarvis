# 00 - Resolve merge targets in both worktree homes

`jarvis1 triage <target> --merge` resolves only under `<repo>/.worktree/`
(`v1/src/commands/resolve-merge-target.ts`, `resolveTriageNamedWorktree` in `v1/src/commands/triage.ts`).
v2 workflows put worktrees at `~/.jarvis/worktrees/<project-key>/<branch>/`, so every v2 PR refuses with
`triage --merge (unknown worktree): …` and gets hand-merged with raw `gh`, skipping the local ready gate
(the only gate that runs `lint:md`).

## Decisions

- Resolution returns a worktree **path**, not a name; `triageMerge` operates on that path — rules out keeping a name
  relative to one hardcoded home.
- v2 home = `<CONFIG_DIR>/worktrees/<project key>` where the key is the registered project whose root matches
  `projectRoot` (`findProjectMatchForPath`); no registered project → v1 home only. Rules out an operator-supplied
  `--worktree-home` flag or deriving the key from the repo basename.
- v1 code must not import from `v2/**`; recompute the two path shapes locally (`worktrees/<key>/<branch>`,
  `worktree-locks/<key>/<branch>`) rather than importing `getExternalWorktreePath`.
- Direct-directory existence in either home is checked **before** the PR-ref and spec-path forms, so a branch-shaped
  arg (`plan/foo`) resolves as a v2 worktree; spec paths still fall through because they do not exist as dirs under a
  home. Rules out treating any `/`-containing arg as a spec path.
- v2 home enumeration walks branch-nested directories (a v2 "name" is a branch and may contain `/`); a directory is a
  worktree when it contains `.git`.
- A target matching in both homes is an ambiguity refusal listing both paths (`unknown worktree` class) — rules out a
  silent v1-first pick.
- `--mark-ready`, drill-down, and the no-arg listing stay v1-home-only (out of scope per intent).

## Acceptance criteria

- [ ] `jarvis1 triage <worktree-or-branch-name> --merge` resolves a worktree living at `~/.jarvis/worktrees/<project>/<branch>/` and runs the gated merge flow against it (local ready gate incl. `lint:md`, draft→ready, CI poll, admin squash) instead of refusing `unknown worktree`.
- [ ] The same v2 worktree resolves from a PR reference (`#N`, URL, bare `N`) and from a spec path (`.active-spec-path` marker / spec-dir basename / plan-slug), matching the v1-home forms.
- [ ] v1-home resolution (all three forms) is unchanged: `triage-command.test.ts` merge-resolution tests stay green.
- [ ] A name or branch that matches a worktree in both homes exits non-zero with a `triage --merge (unknown worktree):` refusal listing both worktree paths, and does not merge.
- [ ] When the project root is not a registered project, resolution searches the v1 home only and refuses as it does today.

## Documentation updates

- `v1/docs/operator-runbook.md` — `--merge` resolves targets in both worktree homes; drop the "hand-merge v2 PRs with raw `gh`" stopgap.
- `v2/docs/v1-behaviors.md` — record the widened resolution (two homes, path-valued resolution, ambiguity refusal, unchanged v1-only `--mark-ready`/listing).
