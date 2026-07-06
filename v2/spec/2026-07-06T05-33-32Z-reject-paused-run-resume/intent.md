---
name: reject-paused-run-resume
---

# Reject paused-run resume with explicit operator error

The daemon `resume` path for paused runs rebuilds `WriteLoopInput` with empty `stepRules`, `expectedArtifactPath`, and `bindings`, then spawns a write loop that fails `no_binding` on first invocation. Replace that placeholder with a `not_implemented`-style operator error in the existing run-operator-error family. Real resume lands after bindings become reconstructable from role + machine profile (seed 08).

## Decisions

- Return run-operator error on paused-run resume — rules out spawning write loop with empty bindings.
- Use existing run-operator-error family (`not_implemented` or equivalent) — rules out ad-hoc error shape or silent success.
- Scope to paused-run resume placeholder only (`daemon.ts` ~888–904) — rules out implementing full resume reconstruction in this slice.
- No new abstractions or helpers — rules out binding-rebuild machinery ahead of seed 08.

## Prerequisites

- v2 lean documentation-standard and in-process daemon-test defaults are landed (seed 01)
- Daemon run-operator-error family exists for structured operator-facing resume failures

## Documentation updates

- `v2/docs/v1-behaviors.md` — paused-run resume returns explicit not-implemented operator error instead of proceeding to write-loop spawn

## Verification

- `bun run typecheck`, `test:v2`, `test:integration:v2`
