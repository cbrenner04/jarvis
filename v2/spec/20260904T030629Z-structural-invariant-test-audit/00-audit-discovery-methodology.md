# Audit discovery contract and methodology

## Problem

Structural-invariant tests under `v2/src/**` and `shared/**` pin real invariants to incidental structure — line numbers, copied registry literals, hand-maintained file lists, symbol names, one-way absence checks — so sound refactors red-gate or pass vacuously. No durable inventory exists to drive re-keying or justify exceptions. Downstream re-key work ([[structural-invariants-key-on-behavior-not-incidental-structure]]) needs a classified baseline first.

## Decisions

- Audit artifact home is `v2/docs/structural-invariant-test-audit.md`; rules out a spec-local-only checklist that later plan runs cannot reuse.
- Intent acceptance criteria defer to per-anchor inventory granularity in subspecs 01–04; rules out file-level “every test” completion at the intent layer.
- Inventory scope is co-located tests under `v2/src/**` and `shared/**` that read production source, pin symbol/file locations, or mirror a registry; rules out `v1/**`, `scripts/**`, `test/**`, and behavioral tests that execute production code without structure pinning.
- A test is in scope when any case reads committed production `.ts` (or git object content of same) for assertion, locates code by symbol name or hand-maintained file list, or asserts against a hardcoded copy of a registry/map/config that also exists in production; rules out tests that only read fixtures, snapshots, or `*.test-support.ts` under their tree.
- `shared/module-boundary-surfaces.test.ts`: only cases that read committed production `.ts` or mirror registries are in scope; fixture-only cases are out; rules out treating the whole file as structural because some cases are behavioral.
- Co-located tests under `v2/src/**` or `shared/**` that read production outside those trees (e.g. `v1/src/**`): inventory rows anchor on paths actually read; test file location determines inventory placement subspec, not production-tree membership; rules out omitting cross-tree reads because production path is out of scope tree.
- Entry granularity is one row per anchor (test file + case/describe scope + anchor mechanism); rules out file-level rows that hide mixed behavioral/incidental anchors in the same file.
- Output schema (tabular, one row per anchor): `row-id` (stable, unique), `test-path`, `case-scope`, `guarded-invariant`, `anchor-mechanism`, `classification` (`behavioral` | `incidental`), `disposition` (`re-key` | `stay-incidental` | `n/a` for behavioral), `stay-incidental-rationale` (required when disposition is `stay-incidental`), `vacuous-pass-risk` (`yes` | `no`, required when mechanism is one-way absence or can pass vacuously); rules out prose-only invariant lists without referencable row ids.
- Classification rubric (tie-break): **behavioral** = invariant would still hold after sound rename/move/reorder without changing observable test outcome; **incidental** = anchor is symbol name, line number, hand-maintained file list, copied registry literal, or one-way absence without paired presence check; baseline guidance in `v2/spec/seeds/structural-invariants-key-on-behavior-not-incidental-structure.md`; rules out ad-hoc per-row judgment without rubric.
- Incidental rows default to disposition `re-key`; `stay-incidental` requires a one-line rationale naming why the anchor cannot track the source of truth; rules out silent incidental pins.
- Discovery pass A (source-read): static scan for `readFileSync`/`git show`/`merge-base` on production paths, `*inventory*`, `*structure*`, `*guard*` filenames, plus manual read of every `v2/src/**/*.test.ts` and `shared/**/*.test.ts` candidate; rules out shipping a list inferred only from seed evidence.
- Discovery pass B (registry-mirror): independent scan for hardcoded literals asserted against production registries/maps/config baselines even when pass A misses them; rules out mirror-only anchors surviving a read-biased scan.
- Candidate manifest publishes every `v2/src/**/*.test.ts` and `shared/**/*.test.ts` file with `in-scope` | `out-of-scope` and one-line rationale; completeness is manifest reconciliation (every in-scope file has ≥1 inventory row; every inventory row cites a manifested file), not process prose alone; rules out partial inventories that tick “every anchor” without falsifiable coverage.
- Illustrative seed examples from [[structural-invariants-key-on-behavior-not-incidental-structure]] (`execution-terminal-settlement-guard.test.ts`, `daemon-test-inventory.test.ts`, `workflow-runner-resume-inventory.test.ts`, `workflow-runner-resume-structure.test.ts`, `diff-derived-mutation-verifier.test.ts`, `daemon-workflow-start.test.ts`, `module-boundary-surfaces.test.ts` plan-draft classifier) are discovery hints only, not completeness checkpoints; rules out false-green when a seed file is missed.
- Methodology section documents excluded trees (`v1/**`, `scripts/**`, `test/**`, fixture-only reads, `*.test-support.ts`) with one-line rationale each; rules out repo-wide structural-debt readings.
- Deferred to first consumer: automated drift guard keeping the audit synchronized with new structural tests — pin when re-key work adds CI enforcement.

## Task checklist

- [ ] Create `v2/docs/structural-invariant-test-audit.md` with methodology section: in-scope definition, excluded trees with rationales, discovery pass A and pass B procedures (commands or patterns), output schema, classification rubric, manifest reconciliation rules.
- [ ] Run discovery pass A and pass B on every `v2/src/**/*.test.ts` and `shared/**/*.test.ts` file; open every candidate; publish the full candidate manifest in the artifact.
- [ ] Document illustrative seed examples in methodology (hints only; completeness governed by manifest reconciliation).

## Acceptance criteria

- [ ] `v2/docs/structural-invariant-test-audit.md` methodology matches **Decisions**: scope, excluded trees with rationales, source-read discovery (pass A), registry-mirror discovery (pass B), output schema, classification rubric, manifest reconciliation rules.
- [ ] Candidate manifest lists every `v2/src/**/*.test.ts` and `shared/**/*.test.ts` file as `in-scope` or `out-of-scope` with a one-line rationale.
- [ ] Methodology documents that every in-scope manifest file must gain ≥1 inventory row in subspecs 01–04 and every inventory row must cite a manifested file.

## Documentation updates

None — `v2/docs/structural-invariant-test-audit.md` is the durable documentation for this intent.
