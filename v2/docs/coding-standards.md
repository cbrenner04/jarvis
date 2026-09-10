# v2 coding standards

The canonical restraint principles for v2 development are defined in the prompt artifact `write.principles` (see [prompts/registry.txt](../../prompts/registry.txt)). All v2 implementation guidance derives from these seven principles.

For the full principle text and decision notes, consult the artifact source directly — it is the single authoritative copy and is injected into the write-step prompt at each iteration.

## Structural-honesty gates

A Biome linter gate enforces structural honesty in v2 and shared code via two rules:

- **`noExcessiveCognitiveComplexity`** (error, threshold 24): Functions exceeding cognitive complexity 24 are errors. The threshold is set to pass all existing non-test code in v2 and shared, enforcing structural honesty (preventing over-nested or over-conditional new logic) without rejecting working code. Test files (`*.test.ts`) are excluded from this rule. Smallness is the planner's and reviewer's job; the gate enforces structure, not size targets.
- **Shared import boundary** (error): Code under `shared/**` must not import from `v1/**` or `v2/**` using relative paths (e.g., `../../v1/...`). The boundary uses relative-aware glob patterns (`**/v1/**`, `**/v2/**`) to catch real import forms. Shared is the lower-layer library consumed by both versions; enforcing its isolation prevents version-specific leakage.

All rules are error-level; no warnings are introduced. The gate scope covers `v2/src/**` and `shared/**` (excluding test files) via Biome `overrides`; the frozen `v1/**` tree is excluded from Biome entirely.

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

`v2/**` and `shared/**` may not introduce synchronous child processes. The only allowlisted module is `shared/subprocess.ts`, the CLI-only synchronous runner seam; new allowlist entries need a CLI-only reason. `bun run check` enforces this, including v2 imports of synchronous runner seams and Git helpers. Small synchronous filesystem reads remain permitted.

## Git status paths

New or migrated path-aware Git status consumers must use `getGitStatusInventory` from `shared/git.ts`; do not parse porcelain output independently.

`bun run check` enforces this lossless inventory boundary via `scripts/guard-lossless-git-status-inventory.ts` for `v2/src/execution/review-intent-enforcement.ts`, `v2/src/execution/completion-commit.ts`, `v2/src/execution/write-loop.ts`, and `v2/src/commands/cleanup.ts`.

## Production test seams

Production code under the scan roots `v2/src` and `shared` (the third root, frozen `v1/src`, is excluded) must not declare a test seam: a type member (interface or type-literal property at any nesting, including intersection and union members and type-parameter constraints), a function, method, constructor, or arrow parameter, a module-level variable, or an exported function or variable whose name ends in `ForTest` or `ForTests`, nor a parameter whose name starts with `invert`. `bun run check` enforces this via `scripts/guard-production-test-flags.ts`, which walks the TypeScript AST of every non-`.test.` file under the scan roots (skipping `shared/prompts/step-rules.ts`) — a mere mention (a type argument, property access, or condition naming such an identifier) is not a declaration and is never flagged. The guard is verified against real source: its rejection fixtures are lifted from production shapes that defeated the previous regex scanner, and a run-time meta-test in `scripts/guard-production-test-flags.test.ts` enumerates candidate seams under the scan roots and proves the guard reports every one. Test-only behavior is injected through neutral dependency seams (for example `persistedRepairFenceEnforcer`, `mutationRepairBindingFactory`), never through a `*ForTest` flag or helper in production.

## Test-support files and the production glob

`*.test-support.ts` files under `v2/src` are test-only fixtures co-located with the module they support (today: `v2/src/execution/workflow-runner.test-support.ts`). They are excluded from the production source glob: `v2/tsconfig.json` lists `src/**/*.test-support.ts` in `exclude` (tests that import them still pull them into the typecheck transitively), and every structural guard shares one production-file predicate, `isProductionSourceFile` in `scripts/production-files.ts` — under `v2/` or `shared/`, `.ts`/`.tsx`, not `*.test.ts`, not `*.test-support.ts`, not `v2/src/testing/**`. New guards use that predicate rather than a private suffix list.

`bun run check` runs `scripts/guard-production-test-support-imports.ts`: a production module that imports a `*.test-support.ts` path (static, type, side-effect, dynamic, `require`, or re-export) fails the gate, and so does a `v2/tsconfig.json` that drops the exclude. Manual red-check: add `import "./workflow-runner.test-support.ts";` to any file under `v2/src/execution/` that is not a test, run `bun run check`, delete the line.

## Export hygiene gate

Every export of a `v2/src` production module (the `isProductionSourceFile` predicate above, restricted to `v2/src/`) must be imported by some other file anywhere in the repo — `v2/`, `shared/`, `scripts/`, and `test/`, tests and the `v2/src/testing/` harness included. `bun run check` runs `scripts/guard-dead-exports.ts`, a static import graph over relative specifiers: named, default, namespace, and dynamic imports plus `export … from` re-exports count as references; an export referenced only inside its own file is dead and must be demoted to module-private, and one referenced nowhere is deleted. The gate replaced the seven-symbol `export-surface-trim.test.ts` pin.

`DEAD_EXPORT_ALLOWLIST` in the script names surface that is intentionally public but statically unreferenced, keyed `<file>#<symbol>` with a reason (today only `v2/src/cli.ts#main`, the `bin/jarvis` entry point). Add an entry only for a real external consumer, never to keep an unused export. Manual red-check: add `export const probe = 1;` to any production file under `v2/src/`, run `bun run check`, delete the line.

## Workflow composition gate

New workflow behavior must compose the existing publication, review, landing, and linked-subspec routing groups. Do not duplicate those groups in preset-specific paths.

If composition requires a new runner dispatch branch, add an exact `## Blocker` to the active subspec instead of extending the runner state machine. Declarative preset-table rows are exempt when they only compose existing groups. This is a planning and implementation standard; it adds no runtime or lint gate.

## Referenced documents

- [`Source layout`](./v2-architecture.md#source-layout) — domain map and import direction
- [`v1-behaviors.md`](./v1-behaviors.md) — v1 behaviors that v2 does not replicate in this build window
- [`test-writing.md`](./test-writing.md) — test-writing conventions for agent-runnable tests and sandbox-unrunnable exceptions
