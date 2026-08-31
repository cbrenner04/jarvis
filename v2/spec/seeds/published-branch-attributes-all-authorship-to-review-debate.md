# Published workflow branch collapses to one review-debate commit, erasing write-stage authorship

## Problem

Every git-enabled workflow (plan and implement) publishes its branch as a **single commit off base**, stamped entirely with the last stage that committed — `review-debate`. The shared completion committer (`v2/src/execution/completion-commit.ts`) snapshots the whole worktree tree with parent = base and CAS-replaces the branch tip on each terminal boundary (implement write → `~shrink` → `review-debate`), so the review stage — which runs last — overwrites the write-stage commit. The published branch's only commit carries `Jarvis-Step: review-debate N` and that stage's `Jarvis-Agent` trailer.

Consequences on the PR:

- The PR-body attribution footer reads `Jarvis-Agent` trailers from `baseRef..HEAD`; with one review-debate commit it renders `## Commits: - review-debate(1): …` and `Written by <review-agent> through Jarvis.` — crediting the **review** agent as the author. The agent that actually drafted the plan/implementation (a different agent whenever the reviewer differs from the drafter) is invisible.
- The commit subject `review-debate(1): <title>` reads as if review authored the whole change, even though the same commit carries the full write-stage diff.

Correctness is unaffected (the commit's tree is complete; squash-merge yields one commit regardless), so this is an **attribution** defect, not a landing defect — but the entire `Jarvis-Agent` footer machinery exists to attribute authorship correctly, and here it systematically mis-credits every workflow PR to its reviewer.

## Evidence (2026-08-31)

- PR #3202 (implement, `derive-mutation-candidates-from-typescript-scanner`): one branch commit `a8bd578b review-debate(1): …`, parent = base; carries the entire +223/-39 implementation; footer `Written by codex through Jarvis` (codex was the review stage).
- PR #3225 (plan, `admit-pipeline-recovery-through-workflow-start`): identical shape — one commit `review-debate(1): plan: …`, footer credits the review agent only.
- Pattern held for every workflow PR inspected this session.

## Decisions

- The published branch must attribute the write stage. Candidate mechanisms (plan loop to choose one): (a) carry every participating stage's `Jarvis-Agent` trailer forward onto the single squashed completion commit so the footer lists implement + shrink + review; (b) stamp the surviving commit with the write-stage agent as primary and record review as a secondary trailer; (c) preserve per-stage commits on the branch (`baseRef..HEAD` then naturally carries each stage's trailer/bullet). Rules out the current single-review-trailer footer that erases the author.
- Keep the single-commit-off-base publish shape if that is the intended clean-PR design — the fix is trailer/footer attribution, not necessarily commit history. Rules out forcing multi-commit history solely for attribution when carried-forward trailers suffice.
- Do not regress the narrative marker block or `Spec:` header handling. Rules out a footer rewrite that drops preserved narrative content.

## Acceptance criteria

- [ ] A publisher/footer test proves that when the write-stage and review-stage agents differ, the published PR body's attribution footer names the write-stage (implementing/plan-drafting) agent, not only the review agent; it fails against the current review-only footer.
- [ ] The surviving published commit (or its footer) carries the write-stage `Jarvis-Agent` attribution for a workflow whose write and review stages ran different agents.
- [ ] Existing narrative-marker preservation and `Spec:`/`## Commits`/`## Change summary` rendering stay green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/worktrees-and-commits.md` — describe how multi-stage authorship (write, shrink, review) is attributed on the single published commit / footer.
- `v2/docs/workflow-runner.md` — the PR-body footer credits the write stage, not only review.

## Sequencing

P2 — cosmetic/attribution, not a correctness or landing blocker, but it mis-credits every workflow PR and undermines the `Jarvis-Agent` attribution contract. Independent of the structural retirements; pairs naturally with any completion-committer work.
