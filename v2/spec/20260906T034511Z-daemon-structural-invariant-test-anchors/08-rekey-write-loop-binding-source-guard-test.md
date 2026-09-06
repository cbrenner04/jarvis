# Re-key write-loop-binding-source-guard.test.ts

## Problem

Rows `dm-wlbinding-callers-allowlist` and `dm-wlbinding-source-markers` in `v2/docs/structural-invariant-test-audit.md` pin binding-resolution ownership to a hand-maintained caller path list and substring presence pins on `daemon.ts`, so legitimate extractions that preserve binding semantics red-gate or pass vacuously when markers move (`vacuous-pass-risk: yes` on `dm-wlbinding-source-markers`).

## Decision ledger

- `resolveWriteLoopBindings` callers are discovered by scanning the `v2/src` production tree and compared to the resolved export/call surface, not equality against `ALLOWED_RESOLVE_WRITE_LOOP_BINDINGS_CALLERS`; rules out red-gates when the seam moves to a sibling module that still owns binding resolution.
- Binding-source markers are located via `locateSymbolSlice` over modules that define `resolveWriteLoopBindings`, not substring pins on a fixed `daemon.ts` path; rules out vacuous pass when markers move with the resolver (`vacuous-pass-risk: yes`).

## Task checklist

- [ ] Re-key audit rows `dm-wlbinding-callers-allowlist` and `dm-wlbinding-source-markers` per the decision ledger.
- [ ] Replace hand-maintained caller allowlist equality with discovered-caller set comparison against the resolver ownership surface.
- [ ] Route binding-source marker checks through shared loud-failure symbol slicing on the owning module.

## Acceptance criteria

- [ ] `write-loop-binding-source-guard.test.ts` test `only allowlisted modules call resolveWriteLoopBindings` discovers callers from the `v2/src` production tree and compares against the resolver ownership surface, not equality with `ALLOWED_RESOLVE_WRITE_LOOP_BINDINGS_CALLERS`; it fails against the pre-fix hardcoded allowlist on audit row `dm-wlbinding-callers-allowlist` and passes after re-key.
- [ ] `write-loop-binding-source-guard.test.ts` test `daemon binding resolution re-loads from the machine profile unless the snapshot replay test hook is set` locates `BINDING_SOURCE_MARKERS` via loud-failure symbol slicing on the module that owns binding resolution, not substring pins on `daemon.ts`; it fails against the pre-fix `daemon.ts`-only marker pins on audit row `dm-wlbinding-source-markers` (`vacuous-pass-risk: yes`) and passes after re-key.
- [ ] Every daemon structural-invariant test tagged `re-key` in `v2/docs/structural-invariant-test-audit.md` anchors on its source of truth or remains `stay-incidental` per the audit with loud-failure locator routing only.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

None — patterns land in `v2/docs/test-writing.md` via a later intent.
