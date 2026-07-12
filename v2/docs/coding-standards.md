# v2 coding standards

The canonical restraint principles for v2 development are defined in the prompt artifact `write.principles` (see [prompts/registry.txt](../../prompts/registry.txt)). All v2 implementation guidance derives from these seven principles.

For the full principle text and decision notes, consult the artifact source directly — it is the single authoritative copy and is injected into the write-step prompt at each iteration.

## Structural-honesty gates

A Biome linter gate enforces structural honesty in v2 and shared code via two rules:

- **`noExcessiveCognitiveComplexity`** (error, threshold 24): Functions exceeding cognitive complexity 24 are errors. The threshold is set to pass all existing non-test code in v2 and shared, enforcing structural honesty (preventing over-nested or over-conditional new logic) without rejecting working code. Test files (`*.test.ts`) are excluded from this rule. Smallness is the planner's and reviewer's job; the gate enforces structure, not size targets.
- **Shared import boundary** (error): Code under `shared/**` must not import from `v1/**` or `v2/**` using relative paths (e.g., `../../v1/...`). The boundary uses relative-aware glob patterns (`**/v1/**`, `**/v2/**`) to catch real import forms. Shared is the lower-layer library consumed by both versions; enforcing its isolation prevents version-specific leakage.

All rules are error-level; no warnings are introduced. The gate scope covers `v2/src/**` and `shared/**` (excluding test files) via Biome `overrides`, leaving `v1/**` untouched.

Manual gate check: paste into a checked path, run `bun run check`, delete the file.

**Complexity** — `v2/src/temp-verify-complexity.ts`:

```typescript
export function overComplex(x: number, y: number, z: number): number {
  if (x > 0) {
    if (y > 0) {
      if (z > 0) {
        if (x > y) {
          if (y > z) {
            if (z > 0) {
              if (x + y > z) return 1;
            }
          }
        }
      }
    }
  }
  return 0;
}
```

Expect `noExcessiveCognitiveComplexity`.

**Shared import boundary** — `shared/temp-verify-import.ts`:

```typescript
import { something } from "../../v1/src/something.ts";
export function probe(): void { console.log(something); }
```

Expect `noRestrictedImports` on the v1 import.

## Test-writing conventions

Tests must be deterministic and sandbox-runnable by default. See [`test-writing.md`](./test-writing.md) for agent-runnable test conventions (dependency injection seams instead of spawning real processes or depending on wall-clock timing) and how to mark the rare real-process/real-clock exception.

## Synchronous subprocesses

`v2/**` and `shared/**` may not introduce synchronous child processes. The
only allowlisted module is `shared/subprocess.ts`, the v1 CLI-only synchronous
runner seam; new allowlist entries need a CLI-only reason. `bun run check`
enforces this, including v2 imports of synchronous runner seams and Git helpers.
Small synchronous filesystem reads remain permitted.

## Referenced documents

- [`Source layout`](./v2-architecture.md#source-layout) — domain map and import direction
- [`v1-behaviors.md`](./v1-behaviors.md) — v1 behaviors that v2 does not replicate in this build window
- [`test-writing.md`](./test-writing.md) — test-writing conventions for agent-runnable tests and sandbox-unrunnable exceptions
