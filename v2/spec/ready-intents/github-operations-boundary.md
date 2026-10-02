---
name: github-operations-boundary
---

# Consolidated GitHub PR operations boundary

## Problem

GitHub PR operations are constructed directly in multiple callers: `v2/src/execution/pr-review-input-capture.ts`, `v2/src/execution/terminal-publication.ts`, `v2/src/commands/cleanup.ts`, and `v2/src/commands/init-readiness.ts` each call `runner.runAsync("gh", […])` with command arrays. `completion-publisher.ts` has private PR helpers (list, create, find, undo flip) that duplicate this work. Consolidating GitHub operations into a typed boundary exposes reusable PR primitives and unifies error semantics.

## Decisions

- Extract or create a new GitHub operations boundary that exposes typed PR operations (list by branch, view merged state, create draft/ready, undo ready flip, close).
- Operations return structured result types (PR number, state, merged timestamp) instead of raw JSON strings.
- Error cases distinguish GitHub service failures, authentication failures, and not-found states.
- Callers inject the GitHub runner via interface for fixture testing and error injection.
- Plan must decide: whether the boundary owns `completion-publisher.ts`, extends it, or creates a new `v2/src/execution/github-operations.ts` file; which error cases are fatal vs. transient; idempotency requirements per operation.

## Prerequisites

- `shared/git.ts` offers consolidated Git operation boundary (delivered by: shared-git-operations-boundary)

## Acceptance criteria

- [ ] A GitHub operations boundary exports typed PR operations with structured return types; duplicated inline calls in cleanup, pr-review-input-capture, terminal-publication, and init-readiness all fail against current code.
- [ ] Operations distinguish GitHub service errors, authentication errors, and not-found states with documented error types.
- [ ] Test file for GitHub operations covers parsing, error cases, and policy (e.g., merged PR detection, ready vs. draft creation).
- [ ] `completion-publisher.ts` tests stay green (no public behavior change to lane completion).
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/v2-architecture.md` — add section on GitHub operation ownership, canonical boundary, and entry points for GitHub PR operations.
- `AGENTS.md` — note that GitHub PR operations have a single owner and callers must use its exports, not construct commands directly.

## Primary implementation surface

- `v2/src/execution/github-operations.ts` (new, or extend completion-publisher.ts) — typed PR operations boundary
- `v2/src/execution/github-operations.test.ts` (if new file) — tests for GitHub operations
