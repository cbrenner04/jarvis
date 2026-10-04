## Verdict — required refinements

### Import matrix (must match today’s graph and intent)

- **Host import surface:** State that all hosts may import libraries, `ipc/`, and `shared/`, and may import sibling hosts for composition/wiring (CLI → daemon/TUI is load-bearing today). Drop or subsume the TUI-only daemon carve-out if the general host rule covers it.
- **Production ↛ `testing/`:** Pin the inverse of `testing/` → anything; only tests may import `testing/`.
- **Library cross-edges:** Resolve persistence → execution: `state-store.ts` type-imports `invocation-failure.ts` (execution). Either forbid persistence → execution and record a relocation fix, or allow an explicit exception (e.g. type-only). Silence yields a false contract against committed code.

### Root-file map and AC₂

- **`daemon-entrypoint.ts`:** Assign it in the domain table (daemon host, root-only per entrypoint policy) so AC₂’s “every root `*.ts`/`*.tsx` in exactly one domain row” is satisfiable.
- **Exhaustive list, not globs:** Task/AC must require an explicit per-file inventory in **Source layout** — overlapping `write*` / `write-loop*` / `write-prompt*` patterns are insufficient for AC₂.
- **`preload.sandbox-unrunnable.test.ts`:** Note harness consumers (`test/test-slices.test.ts` hardcodes the path) in the testing row or a follow-on flag so relocation does not surprise.

### Wording that contradicts repo reality

- **`v2/test/` decision:** Narrow “no parallel `v2/test/` tree” to no mirror of `v2/src/`; except grandfathered `v2/test/fixtures/` (Biome demos), aligned with `v2-vision.md`.

### Doc implementation obligations

- **Same-file staleness:** Adding **Source layout** to `v2-architecture.md` must reconcile or forward-reference stale flat-root citations (e.g. `v2/src/daemon-lifecycle.ts` → `daemon/`) so one file does not contradict itself.
- **Entrypoint policy:** Name `daemon-lifecycle.ts` default spawn (`resolve(import.meta.dir, "daemon-entrypoint.ts")`) and `bin/jarvis` coupling so relocation co-update is visible without reading source.
- **AC₁ coverage:** Extend AC₁ (or align checklist) so co-located-test convention and no-barrel rule are acceptance-checked, not checklist-only.
- **Phase 0 historiography:** `v2-build-order.md` Phase 0 must preserve what shipped (flat root) and forward-reference **Source layout** as target shape — not rewrite Phase 0 as if domains always existed.

### Optional (non-blocking)

- Prerequisite or task step: diff root inventory against table before doc work.
- **Source layout** note that matrix is target direction; Biome enforcement may lag until relocation + follow-on subspec.
- One sentence that **Source layout** subsumes “module responsibilities” for `coding-standards.md` pointer — avoids extra doc file in updates.

### Upheld without refinement

- Single **Source layout** home in `v2-architecture.md`; doc-only first slice; entrypoints at root; no barrels; `ipc/`/`testing/` in place; `v1-behaviors.md` out of scope; relocation subspecs stay in `ready-intents/` after merge; cross-doc path fixes land with relocation subspecs.

### Rationale

Import-matrix gaps and AC₂/`daemon-entrypoint` inconsistency would pin a contract falsified by current imports and inventory — violating spec guidance that structure-as-contract must be verifiable. `v2/test/fixtures/` and Phase 0 history mismatches would mislead implementers. Same-file contradictions violate `documentation-standard.md` single-home policy.
