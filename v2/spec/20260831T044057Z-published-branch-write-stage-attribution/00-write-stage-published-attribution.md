# Credit write-stage agent on the published completion commit and PR footer

## Problem

Git-enabled plan and implement workflows publish one commit off base whose tip is CAS-replaced at each terminal boundary (`write` → optional `~shrink` → `review`/`review-debate`). The surviving commit is stamped with only the terminal review step's `Jarvis-Agent` trailer, erasing write-stage authorship. `renderAttribution` reads `baseRef..HEAD`; with a single review-classified commit the footer renders `Written by <review-agent> through Jarvis.` even when a different agent drafted the plan or implementation.

## Surface

`v2/src/execution/completion-commit.ts`, `v2/src/execution/workflow-runner.ts` publication tail, `v2/src/execution/pr-attribution.ts` (only if footer rendering must honor carried-forward trailers), and co-located tests. Single-commit-off-base shape, `Spec:` header regeneration, narrative marker preservation, `## Commits`, and `## Change summary` rendering stay unchanged.

## Decision ledger

- Keep the single-commit-off-base publish shape and fix trailer/footer attribution on the surviving commit; rules out multi-commit branch history solely for attribution when carried-forward trailers suffice.
- Minimum attribution contract when write ≠ review: the write-stage agent must appear in the surviving commit's `Jarvis-Agent` trailer(s) and in the footer `Written by` line (and matching commit bullet label); the review agent may also appear but must not be the sole credited agent. Exact carry-forward shape (write-only vs write-primary with review secondary vs all-stage trailers) remains implementer choice, bounded by this contract.
- Step classification and authorship credit intentionally diverge on the CAS-replaced single published commit: `Jarvis-Step` and the `review-debate(n):` subject prefix remain truthful to the terminal publication boundary; `Jarvis-Agent` and `Written by` credit the drafting (write-stage) agent when it differs from review. Supersedes the multi-commit/per-pass authorship rule docs currently describe for review-classified commits.
- Write-stage agent means the durable agent that actually ran the write step — the same resolution path production uses for non-mutating-review fallback (`reviewCompletionAgent` on the write-step run's durable row), not the review boundary agent and not `completionStep.agents[0]` by default.
- When shrink runs the same agent as write, write-stage credit covers shrink; distinct shrink agents are out of scope for this spec unless separately evidenced.
- Preserve narrative marker blocks and regenerated header/footer assembly; rules out a footer rewrite that drops preserved narrative content.

## Task checklist

- Add a publication integration regression in `workflow-runner-publication.test.ts` that drives a reviewed-last workflow where write and review agents differ and asserts the ensured PR body's attribution footer names the write-stage agent.
- Add a same-agent preservation regression in `workflow-runner-publication.test.ts` that drives a reviewed-last workflow where write and review share one agent and asserts commit trailer and footer credit that agent once with no spurious second label.
- Add a completion-commit regression in `completion-commit.test.ts` that simulates the terminal review CAS-replace path and asserts the surviving published commit carries the write-stage `Jarvis-Agent` when write and review agents differ.
- Implement trailer carry-forward (or equivalent) in the completion committer and/or publication tail so the surviving single commit and footer satisfy the regressions without changing publish shape.
- Update `v1/docs/worktrees-and-commits.md`, `v2/docs/workflow-runner.md`, and `v2/docs/v1-behaviors.md` (include step-vs-authorship divergence on the single published commit).

## Acceptance criteria

- [x] `workflow-runner-publication.test.ts` test `credits the write-stage agent in the attribution footer when write and review agents differ` fails against the current review-only footer.
- [x] `completion-commit.test.ts` test `published completion commit carries write-stage Jarvis-Agent when write and review agents differ` fails against the pre-fix path where only `review-debate` stamps the commit.
- [x] `workflow-runner-publication.test.ts` test `preserves single-agent attribution in the footer when write and review agents match` stays green.
- [x] `pr-body-refresh.test.ts` stays green.
- [x] `pr-attribution.test.ts` stays green.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- `v1/docs/worktrees-and-commits.md` — write-stage vs review-stage authorship on the single published commit and footer when agents differ; `Jarvis-Step`/subject prefix stay terminal-boundary truthful while `Jarvis-Agent`/`Written by` credit the write stage when it differs from review.
- `v2/docs/workflow-runner.md` — PR-body footer credits the write stage, not only review; same step-vs-authorship divergence on the CAS-replaced single commit.
- `v2/docs/v1-behaviors.md` — record corrected published-branch attribution when write and review agents differ, including step-vs-authorship divergence.
