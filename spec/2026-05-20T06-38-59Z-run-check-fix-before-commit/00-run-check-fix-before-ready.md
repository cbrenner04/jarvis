# 00 — Run `check:fix` immediately before the ready gate

## Problem

Jarvis already treats `bun run ready` as the draft-to-ready gate for both patch-mode implementation PRs and plan-mode spec PRs. That gate currently runs without a preceding `bun run check:fix`, so the final `check` inside `ready` can still fail on auto-fixable Biome issues that were not cleaned up before the harness tried to flip the PR out of draft.

The user's correction narrows scope: this is not a patch-commit hygiene change and not a general earlier-loop verification change. The only behavior change should be at the existing readiness transition, immediately before `bun run ready` executes.

## Decisions (locked)

- Run `bun run check:fix` immediately before `bun run ready` in every harness-owned path that transitions a PR from draft to ready today.
- Keep the scope limited to the readiness path. Do not run `check:fix` before patch-mode WIP or subspec commits, and do not add new pre-commit hooks or broader loop gates.
- Apply the fixer in the same worktree `cwd` already used for the subsequent ready/`gh pr ready` calls so the write scope matches the PR branch being promoted.
- Preserve the existing ready gate after the fixer. The sequence is `bun run check:fix` -> `bun run ready` -> `gh pr ready`, and each step short-circuits on failure.
- Use one shared helper for the readiness command sequence so patch mode and plan mode cannot drift in command order or failure shaping.
- Reuse the existing error style that captures child-process `stdout`/`stderr` and appends it to the thrown message. `check:fix` failures should surface with the same level of detail as `ready` failures.
- `check:fix` remains repo-wide within the target worktree because `package.json` already defines it as `biome check --write .`. Do not try to scope it to only modified files in this change.

## Tasks

- [ ] Extract or add a shared readiness helper that runs `bun run check:fix`, then `bun run ready`, then `gh pr ready` in one place.
- [ ] Update the patch-mode PR readiness path to use the shared helper without changing its existing completion/preflight logic.
- [ ] Update the plan-mode PR readiness path to use the same shared helper before marking the PR ready.
- [ ] Keep failure handling consistent with existing readiness behavior: if `check:fix` fails, stop before `bun run ready`; if `ready` fails, stop before `gh pr ready`; in both cases leave the PR in draft and surface captured output in the thrown error.
- [ ] Add focused tests covering the successful sequence and the two failure branches (`check:fix` failure, `ready` failure) through the existing readiness test surfaces.

## Acceptance criteria

- [ ] There is exactly one harness-owned implementation of the draft-to-ready command sequence that runs `bun run check:fix` before `bun run ready` and `gh pr ready`.
- [ ] Patch mode uses that shared sequence when all linked subspecs are complete and a PR exists.
- [ ] Plan mode uses that shared sequence when its PR-ready transition runs.
- [ ] When `bun run check:fix` fails, Jarvis does not invoke `bun run ready` or `gh pr ready`, and the thrown error includes any available `stdout`/`stderr` from the fixer process.
- [ ] When `bun run ready` fails after a successful `check:fix`, Jarvis does not invoke `gh pr ready`, and the thrown error includes any available `stdout`/`stderr` from the ready process.
- [ ] When both commands succeed, Jarvis invokes `gh pr ready` afterward from the same worktree `cwd`.
- [ ] Focused tests cover the shared command ordering and both failure branches in the readiness helpers without broadening scope into unrelated patch-loop or plan-loop behavior.

## Documentation updates

- [ ] Update the operator-facing docs listed in subspec 01 so they describe the new readiness sequence as `check:fix` followed by `ready`, not `ready` alone.

## Out of scope

- Running `check:fix` before harness-created patch commits.
- Moving `typecheck`, `test`, or `check` earlier than the existing `ready` gate.
- Changing the definition of `check:fix` or `ready` in `package.json`.
- Adding git hooks, CI changes, or non-readiness uses of `check:fix`.
