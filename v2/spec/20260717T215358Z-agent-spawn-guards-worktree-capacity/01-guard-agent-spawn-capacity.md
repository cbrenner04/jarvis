# 01 - Guard agent spawns from worktree capacity

## Problem

Each registered Git worktree expands an agent sandbox's deny-path set. Past a limit,
command execution fails with `E2BIG` even for trivial commands, and v2 discovers this
only after an agent has already worked and reached verification — quota already spent.
Before every production v2 agent subprocess, prune stale worktree registrations, retire
only cleanup-eligible workspaces (via the seam from 00), then decide from the remaining
registration count: warn the operator, or refuse before spending quota.

## Decisions

- Measure sandbox cost by counting live `git worktree list --porcelain` registrations across each distinct registered repository at the spawn boundary; rules out estimating from `~/.jarvis/worktrees/` directory count or durable run rows, which drift from what the sandbox actually denies.
- Run `git worktree prune`, then non-interactively retire cleanup-eligible workspaces through the 00 seam, before counting; rules out stale or reclaimable registrations inflating the count into a false refusal.
- Deduplicate repositories by Git common directory before counting; rules out charging one registration set once per registry alias pointing at the same repo.
- Warn before refusing; refuse before `binding.invoke`; rules out surfacing capacity failure only during implementation verification after quota is spent.
- Compose the guard as an injected, behavior-agnostic pre-spawn callback in the shared executor, applied to every production v2 role (implement, plan/intent, review, revision, token/blocker re-prompts) while leaving injected test bindings and v1 invocation unchanged; rules out guarding only implement's first iteration or forking v1 behavior.
- Fail closed: when prune, enumeration, eligibility, or retirement cannot establish a below-refusal count, refuse; rules out spending quota with capacity state unknown.
- Thresholds are a config surface (warn tier < refuse tier). Deferred to first consumer: the concrete warn/refuse worktree counts — the spec pins no numbers; the guard exposes them as config and the implementer selects initial defaults when wiring, tuned against the observed sandbox limit. Pin when a caller needs it.

## Task checklist

- Add a capacity module: prune, deduplicated cross-repo registration count, retire-eligible via the 00 seam, tier classification (below / warn / refuse), typed warning and refusal results, with injectable Git, cleanup-seam, registry, daemon, and state seams.
- Wire it as a pre-spawn callback in `shared/invocation` so it settles before each real agent spawn in `executeWithQuotaFallback`, surfacing warning/refusal through the run's existing operator-visible output and a typed pre-spawn failure that spends no quota.
- Add unit coverage and a workflow-path regression proving the guard fires for a non-implement role and a fallback/re-prompt invocation, and that injected test bindings stay isolated from host Git state.

## Acceptance criteria

- [ ] Immediately before every production v2 agent subprocess, stale worktree registrations are pruned and the remaining registrations across distinct registered repositories are counted once; directory debris and duplicate registry aliases pointing at the same repo do not inflate the count.
- [ ] Cleanup-eligible merged workspaces are retired through the 00 seam (with its immediate pre-removal recheck) before the capacity decision; live, unmerged, daemon-unknown, or otherwise ineligible workspaces are left untouched.
- [ ] Given a configured warn threshold below a configured refuse threshold, a post-retirement count in the warn band emits exactly one warning per logical invocation — naming the count, the sandbox `E2BIG` risk, and `jarvis cleanup` recovery — then invokes the agent normally.
- [ ] At or above the configured refuse threshold, or when capacity cannot be established safely, the run stops before `binding.invoke` with a typed failure reporting the count, the risk, and `jarvis cleanup` recovery; no agent subprocess is spawned and no quota is spent.
- [ ] `v2/src/execution/agent-spawn-capacity.test.ts` fails against the baseline and, with injected thresholds, proves the below-warn, warn, refuse, stale-prune, safe-retirement, fail-closed, and no-agent-invocation-on-refusal cases through the production guard seam.
- [ ] A workflow-path test proves a non-implement role and a fallback or re-prompt invocation also cross the guard, while injected test bindings remain isolated from host Git state.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — document the capacity warning, refusal, and `jarvis cleanup` recovery; remove the manual worktree-removal stopgap and the no-cleanup gotcha the guard supersedes.
- `v1/docs/operator-runbook.md` — remove the mid-session cleanup caveat and the `E2BIG` worktree-count diagnosis now that the v2 preflight owns prevention.
- `v2/docs/v1-behaviors.md` — record the v2-only agent-spawn worktree-capacity guard as a `[v2 additive]` entry with its `Sources:` citation.
- `v2/docs/shared-invocation.md` — document the pre-spawn callback boundary while noting the shared executor stays behavior-agnostic.
