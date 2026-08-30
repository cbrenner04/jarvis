---
name: match-git-disabled-chained-stage-workspaces
---

# Match git-disabled chained-stage workspaces

## Problem

Chained plan and implement stages cannot map prior git-disabled stage workspaces back to their registered project because those workspaces live outside both the admission root and `~/.jarvis/worktrees/<key>/`.

## Module-boundary surface

- Daemon

## Decisions

- Match paths under `~/.jarvis/intent-work/<project-safe-id>/` and `~/.jarvis/specs/<project-safe-id>/` to `{ key, root: admissionRoot }`; rules out threading project identity through persisted stage artifacts.
- Derive managed-root identity from each registered key through the shared transform; rules out duplicating path normalization in daemon code.
- Preserve the direct project-match fallback for paths outside recognized managed roots; rules out broad ownership claims for unrelated workspaces.
- Keep external ready-intent CLI admission and fan-out lane semantics out of scope; rules out coupling this dispatch fix to separate UX or orchestration changes.

## Acceptance criteria

- [ ] `pipeline-stage-resolve.test.ts` proves a prior path under `~/.jarvis/intent-work/<safeId>/<slug>` resolves to the registered key and admission `cwd`, and the test fails against the pre-fix matcher.
- [ ] `pipeline-stage-resolve.test.ts` proves a prior path under `~/.jarvis/specs/<safeId>/plans/<name>/` resolves to the registered key and admission `cwd`, and the test fails against the pre-fix matcher.
- [ ] A matcher regression test uses a registered key containing `/` and proves both git-disabled managed roots resolve through its `projectSafeId` segment; it fails against the pre-fix matcher.
- [ ] A matcher test proves paths under `jarvisHome()/worktrees/<key>/` still resolve to `{ key, root: admissionRoot }`; it fails if git-enabled worktree matching regresses.
- [ ] A matcher test in a multi-project setup proves a `findProjectMatch`-able path outside every registered managed root returns bare terminal `findProjectMatch` with no managed-root override; it fails if managed-root matching incorrectly claims that path.
- [ ] `pipeline-stage-resolve.test.ts` — `"plan stage resolves through real preset builders when ready-intent exists only on git-disabled intent workspace"` exercises chained plan resolution when the prior worktree is a git-disabled intent workspace; it fails against the pre-fix matcher.
- [ ] `pipeline-stage-resolve.test.ts` — `"implement stage resolves through real preset builders when plan spec exists only on git-disabled plan workspace"` exercises chained implement resolution when the prior worktree is `specs/<safeId>/plans/<name>/`; it fails against the pre-fix matcher.
- [ ] `pipeline-stage-resolve.test.ts` — `"plan stage resolves through real preset builders when ready-intent exists only on intent worktree"`, `"implement stage resolves through real preset builders when plan spec exists only on plan worktree branch"`, and `"implement stage normalizes the recorded plan directory artifact through real preset builders"` stay green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` documents chained-stage project resolution for all three managed-root families (`worktrees` raw key; `intent-work` and `specs` via `projectSafeId`), returned `root` as admission `cwd`, and `plans/<name>/` / `ready-intents/` examples consistent with publication.
- `v2/docs/v1-behaviors.md` records the additive chained-stage resolution behavior for the parity baseline.

## Prerequisites

- Intent and plan publication derive external workspace roots from one shared project-safe ID transform without changing their existing paths.
