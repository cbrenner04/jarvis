# 00 - Guard agent spawns from worktree capacity

## Problem

Each registered Git worktree expands an agent sandbox's deny paths. At 67 worktrees, command execution failed with `E2BIG` even for `pwd`; v2 currently discovers this only after an agent has worked and reaches verification. Before every v2 agent subprocess, prune stale registrations, retire only cleanup-eligible workspaces, then warn or refuse from the remaining registration count.

## Decisions

- Count `git worktree list --porcelain` registrations across each distinct registered project repository immediately before `binding.invoke`; rules out counting directories, durable rows, or only `~/.jarvis/worktrees/` contents.
- Run `git worktree prune` before counting, then non-interactively retire only candidates that pass cleanup's merged-PR, non-terminal-run, and live-daemon gate; rules out stale registrations inflating risk or a weaker automatic-deletion policy.
- Reuse cleanup discovery, eligibility, recheck, and Git retirement operations through a shared non-interactive seam; rules out duplicating ownership logic or bypassing the pre-removal race check.
- Deduplicate repositories by Git common directory before pruning and counting; rules out charging one registration set once per registry alias.
- Warn at 40 remaining registered worktrees and refuse at 60; rules out waiting for the observed 67-worktree failure, while preserving a 20-worktree cleanup window.
- Emit the warning once per logical invocation and continue; refuse with a typed pre-spawn failure before the first binding subprocess and report count, threshold, `E2BIG` risk, and `jarvis cleanup` recovery; rules out repeated fallback-rung warnings or an unactionable generic agent error.
- Fail closed when pruning, enumeration, eligibility, or automatic retirement cannot establish a safe below-refusal count; rules out spending agent quota when capacity state is unknown.
- Apply the guard to every production v2 role, including fallback, review, revision, and token/blocker re-prompts, while leaving injected test bindings and v1 invocation unchanged; rules out guarding only implement's first iteration or changing v1 behavior.

## Implementation

- Extract cleanup's safe non-interactive retirement path so the CLI confirmation flow and spawn guard share discovery, eligibility, immediate recheck, and removal.
- Add registered-worktree pruning, deduplicated counting, tier classification, and typed warning/refusal results with injectable Git, cleanup, registry, daemon, and state seams.
- Compose the guard through an injected, behavior-agnostic shared-executor pre-spawn callback so it settles before each real agent spawn and surfaces warning/refusal through the run's existing operator-visible output.
- Add focused unit and workflow-path regression coverage for pruning, safe retirement, thresholds, failures, and no-spawn ordering.

## Documentation updates

- `v2/docs/operator-runbook.md` — document warning/refusal output and `jarvis cleanup` recovery; remove the manual worktree-removal stopgap and no-cleanup gotcha superseded by the guard.
- `v1/docs/operator-runbook.md` — remove the mid-session cleanup caveat and `E2BIG` worktree-count diagnosis superseded by v2 prevention.
- `v2/docs/v1-behaviors.md` — record the v2-only agent-spawn capacity guard and its divergence from v1.
- `v2/docs/shared-invocation.md` — document the v2 pre-spawn wrapper boundary while preserving the behavior-agnostic shared executor.

## Acceptance criteria

- [ ] Immediately before every production v2 agent subprocess, stale Git worktree registrations are pruned and remaining registrations across distinct registered repositories are counted once; directory debris and duplicate registry aliases do not inflate the count.
- [ ] Cleanup-eligible merged v2 workspaces are rechecked and retired before the final capacity decision; live, unmerged, daemon-unknown, or otherwise ineligible workspaces remain untouched.
- [ ] At 40–59 remaining worktrees, the run emits one warning for the logical invocation naming the count, `E2BIG` risk, 60-worktree refusal threshold, and `jarvis cleanup`, then invokes the agent normally.
- [ ] At 60 or more remaining worktrees, or when capacity cannot be established safely, the run stops with actionable capacity detail before `binding.invoke`; no agent quota is spent.
- [ ] `v2/src/execution/agent-spawn-capacity.test.ts` fails against the baseline and proves below-warning, warning, refusal, stale-prune, safe-retirement, fail-closed, and zero-agent-invocation cases through the production v2 guard seam.
- [ ] A production workflow-path test proves a non-implement role and a fallback or re-prompt invocation also cross the guard, while injected bindings remain isolated from host Git state.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
