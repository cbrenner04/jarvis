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

- [ ] `pipeline-stage-resolve.test.ts` proves a prior path under `~/.jarvis/intent-work/<safeId>/<slug>` resolves to the registered key and admission root, and the test fails against the pre-fix matcher.
- [ ] `pipeline-stage-resolve.test.ts` proves a prior path under `~/.jarvis/specs/<safeId>/plans/<name>` resolves to the registered key and admission root, and the test fails against the pre-fix matcher.
- [ ] A matcher regression test uses a registered key containing `/` and proves both managed roots are resolved through its transformed path segment.
- [ ] An existing or new matcher test proves an unmatched path outside the admission root and all registered managed roots still returns the direct-match fallback.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` documents chained-stage project resolution for both git-disabled managed root families.
- `v2/docs/v1-behaviors.md` records the additive chained-stage resolution behavior for the parity baseline.

## Prerequisites

- Intent and plan publication derive external workspace roots from one shared project-safe ID transform without changing their existing paths.
