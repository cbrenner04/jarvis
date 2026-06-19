# v1 harness hardening — deterministic boundaries, dedupe, speed

Jun 2026 review: harness owns git/worktree/loop/gates/commits, but routing and verification still lean on agent prompt discipline when the harness already has the data. Wall clock is dominated by **agent CLI invocations** and **full `bun run ready`** (install → check:fix → typecheck → test → check), often run twice on the happy path (completion gate + review final gate). Split into independently shippable behaviors.

## Problem

**Correctness / structure**
- Harness computes active subspec (`getActiveLinkedSubspecPath`) but prompt still tells agent to pick first unchecked link — duplicate routing, wasted tokens, occasional mismatch.
- Repo guidance (`AGENTS.md`, `CLAUDE.md`) is "discover yourself" instead of pre-injected context.
- Spec parsing, blocker detection, PR narrative, spec-tree inlining, porcelain snapshots, quota fallback loops are duplicated across patch/plan/review.
- `patch/run.ts` (~2k LOC) and `commands/plan.ts` (~1.5k LOC) are god modules mixing preflight, iteration, completion pipeline, and PR.
- `shared/invocation/execute.ts` exists; v1 reimplements quota fallback in three places.
- Plan structural rules (behavioral ACs, heading contracts) live in prompts; harness only checks index/subspec existence.

**Speed**
- Typical complete patch run: N implementation agents + completion `ready` + shrink agent + 4 review agents/cycle + review **final** `ready` (full pipeline again) + PR narrative agent on every subspec complete after the first.
- `scripts/ready.ts` always runs `bun install --frozen-lockfile` even when lockfile/`node_modules` unchanged.
- Shrink contract runs `bun run test` again after completion `ready` even when shrink made no changes.
- Review/shrink prompts inline unbounded full spec tree + full branch diff; PR narrative agent gets up to 40k chars of spec context.
- No config to skip shrink; only `modes.review.passes: 0` skips review today.

## Agreed direction (split into separate intents/specs)

### A. Harness-owned patch routing + prompt slimming
Inject active subspec path + inlined subspec body into patch prompt. Shorten `patch.rules` iteration section — harness picks, agent executes. Bounded repo-guidance preload (`AGENTS.md`, root `CLAUDE.md`). Implementation iterations get **active subspec only**, not full spec tree. Review/shrink: cap or summarize branch diff (stat + changed paths; full diff only for allowlisted shrink files).

### B. Shared spec + blocker parsing
One module for `parsePatchSpec`, index checklist, `## Blocker`, acceptance criteria. Consumers: patch, plan, triage. Delete thin `patch/blocker.ts` and `plan/blocker.ts` wrappers.

### C. Shared PR module + narrative default + deferred PR updates
Merge `modes/patch/pr.ts`, `modes/plan/pr.ts`, both `pr-description-prompt.ts`. Default PR narrative: deterministic template (index H1, subspec titles, commit subjects). Config: `modes.patch.prNarrative` / `modes.plan.prNarrative`: `template` | `agent` (default `template`). **Defer** `updatePrBody` / `gh pr edit` to completion pipeline (once before shrink/review), not every subspec complete — first subspec still `ensureDraftPr`.

### D. Shared invocation executor
Route patch/plan/review/shrink quota fallback through `shared/invocation/execute.ts` + v1 spawn bindings.

### E. Plan draft structural validation
Extend `validateDraftOutput` beyond index/subspec/blocker ordering: exact `## Acceptance criteria`, duplicate-section warnings, coarse behavioral-vs-structural AC checks (reuse parser). Fail before `plan: draft` commit.

### F. Split god modules
- `patch/run.ts` → `preflight.ts`, `iteration.ts`, `completion-pipeline.ts`, thin `run.ts`
- `commands/plan.ts` → `modes/plan/run.ts` for phase orchestration, CLI stays args-only

### G. Shrink: tooling-first ladder + config off switch
Keep post-completion placement (after green ready, before review). Config `modes.patch.shrink`: `off` | `tooling` | `agent` | `both` (default `both` during transition, document `off` for inner-loop). Deterministic pre-pass: `check:fix` on allowlist + diff-stat gate. Agent shrink only when tooling is a no-op and bloat heuristics still match. Contract: skip `bun run test` when shrink produced no file changes; otherwise unchanged guards (AC regression, no deleted scoped tests). `off` skips the phase entirely.

### H. Vestigial cleanup
Remove dead non-index `runIteration` path (preflight already blocks normal CLI). Reconcile `worktrees-and-commits.md` plan:intent/refine doc drift.

### I. Tiered ready pipeline + gate reuse
Split `scripts/ready.ts` into tiers:
- **fast**: `typecheck` + `test` (mid-run reuse, shrink contract when tests already green)
- **full**: `install` (skip when lockfile + `node_modules` digest unchanged) → `check:fix` → `typecheck` → `test` → `check`

Harness uses fast tier for recorded-green reuse paths where safe; full tier at completion transition and once immediately before `gh pr ready`. **Review final gate** reuses recorded green when HEAD + clean tree match completion gate (today it always runs full `ready` — duplicate test suite on happy path). `runReadyAndCommit` seam stays; wire tiers through it.

### J. Review/shrink model tiering (config only)
Optional `modes.review.agentOrder` entries default to same as today; document using faster models for adversary/advocate/adjudicator vs actuator. No new runner logic — config/docs slice so operators don't pay thinking-model latency on read-only review roles.

## Explicitly deferred / separate decisions

### Acceptance-criteria auto-tick
Today: agent owns ticks; harness never auto-ticks (`harden-tick-on-completion-rule` intent: "harness cannot judge criteria"). v2 wants harness-owned contracts. **Separate intent** — harness auto-tick only when scoped typecheck/test pass + in-scope diff, terminal subspec only. Pairs with I (harness verifies, agent stops re-running tests). Update `v2/docs/v1-behaviors.md` if changed.

### Plan prerequisite gate
Agent-reads-repo + `## Blocker` stays. No deterministic automation in this bundle.

## Operator knobs (today, no code)

- `modes.review.passes: 0` — drops ~4 agents + 1 `ready` per complete patch run; best single config win for inner-loop.
- Smaller index-routed specs — fewer implementation iterations dominates agent count.

## Prerequisites

- `v2/docs/v1-behaviors.md` maintained per behavior change
- `bun run typecheck` and `bun run test` pass per subspec
- Prompt fixture snapshots updated when rendered bytes change

## Suggested split (intent fan-out)

One intent per letter (A–J). **Speed-first order:** I → A → C → G → D → B → E → H → F → J.

Rationale: I and C remove duplicate minutes without touching agent semantics; A cuts per-call latency; G adds `shrink: off` for fast path; D/B/E are structural; F is refactor after behavior lands; J is docs/config guidance only.

## Out of scope

- v2 engine / daemon / state store
- Review debate role topology changes (sequential adversary → advocate → adjudicator stays)
- Parallel review agents
- Intent split semantics
- Full prerequisite automation
- Auto-tick without dedicated spec
- Session resume / multi-turn agent continuity
