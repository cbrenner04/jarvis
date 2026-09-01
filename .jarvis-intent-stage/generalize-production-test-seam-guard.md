---
name: generalize-production-test-seam-guard
---

# Generalize production test-seam guard

## Primary implementation surface

- `scripts/guard-production-test-flags.ts`

## Problem

`guard-production-test-flags.ts` regexes only the historical `invert*ForTest` family and misses `ForTest`/`ForTests` setters and other module-level mutable production test seams.

## Behavior

- Generalize the guard to flag any `ForTest`/`ForTests` identifier or module-level mutable test seam in production `src/` outside `testing/`.
- Retain existing `invert*` detection; add guard self-tests for the broadened shapes.

## Decision ledger

- Broaden detection beyond `invert*` hooks; rules out a guard that only covers the last incident family.
- Keep scanning `v2/src`, `v1/src`, and `shared` production trees; rules out limiting the guard to daemon-only paths.

## Prerequisites

- Daemon production code exposes write-loop binding only through constructor/argument injection with no module-level mutable test globals.
- CLI workflow attach-wait behavior is controlled only through constructor/argument injection with no module-level mutable test globals.

## Acceptance criteria

- [ ] `scripts/guard-production-test-flags.test.ts` fails when a synthetic `ForTest` setter is added to a scanned production file and passes on the clean tree.
- [ ] `scripts/guard-production-test-flags.test.ts` invert-shape cases stay green (existing guard contract preserved).
- [ ] `bun run check` still runs the guard.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/coding-standards.md` — broaden the production test-seam prohibition to cover generalized `ForTest`/`ForTests` shapes enforced by the guard.
