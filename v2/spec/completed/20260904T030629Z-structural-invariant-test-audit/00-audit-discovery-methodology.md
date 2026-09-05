# Audit discovery contract and methodology

## Problem

Structural-invariant tests under `v2/src/**` and `shared/**` pin real invariants to incidental structure — line numbers, copied registry literals, hand-maintained file lists, symbol names, one-way absence checks — so sound refactors red-gate or pass vacuously. No durable inventory exists to drive re-keying or justify exceptions. Downstream re-key work ([[structural-invariants-key-on-behavior-not-incidental-structure]]) needs a classified baseline first.

There are 183 co-located test files under those trees (~117k lines). A methodology that requires reading all of them to hand-write an in/out-of-scope rationale per file cannot be executed honestly inside one iteration budget, and its completeness criterion is one the implementing agent grades itself on — the likely failure is a fabricated manifest, which is worse than no audit because the re-key work would trust it. Candidate discovery is mechanical and must be executed by committed code whose output an operator can reproduce.

## Decisions

- Audit artifact home is `v2/docs/structural-invariant-test-audit.md`; rules out a spec-local-only checklist that later plan runs cannot reuse.
- Candidate discovery is a committed, re-runnable script (`scripts/discover-structural-invariant-tests.ts`) whose stdout **is** the candidate manifest; the artifact embeds its output verbatim. Rules out a hand-authored manifest and makes completeness reproducible by re-running the script rather than trusting the author.
- The script classifies every `v2/src/**/*.test.ts` and `shared/**/*.test.ts` file `in-scope` or `out-of-scope` and emits the matched rule name as the rationale; rules out per-file prose rationales for the ~118 files no rule matches.
- Scope rules, each emitted by name when it matches: (A) **source-read** — the file references `readFileSync`, `readFile(`, `git show`, or `merge-base` against a production path; (B) **registry-mirror** — the file declares a hardcoded array/object literal asserted against a production registry, map, or config baseline; (C) **structural-name** — the filename matches `inventory|structure|guard|boundary|parity`. Any match is in-scope; no match is out-of-scope with rationale `no-structural-signal`. Rules out a read-biased scan that misses mirror-only anchors.
- Rule B is the rule a pure text scan is weakest at, so the script may over-include for it; an over-included file is dispositioned at inventory time in subspecs 01–04, never silently dropped by the script. Rules out tuning the script toward false negatives to shrink the inventory.
- Intent acceptance criteria defer to per-anchor inventory granularity in subspecs 01–04; rules out file-level "every test" completion at the intent layer.
- Inventory scope is co-located tests under `v2/src/**` and `shared/**`; rules out `v1/**`, `scripts/**`, `test/**`, and behavioral tests that execute production code without structure pinning.
- `shared/module-boundary-surfaces.test.ts`: only cases that read committed production `.ts` or mirror registries are in scope; fixture-only cases are out; rules out treating the whole file as structural because some cases are behavioral.
- Co-located tests under `v2/src/**` or `shared/**` that read production outside those trees (e.g. `v1/src/**`): inventory rows anchor on paths actually read; test file location determines inventory placement subspec, not production-tree membership; rules out omitting cross-tree reads because production path is out of scope tree.
- Entry granularity is one row per anchor (test file + case/describe scope + anchor mechanism); rules out file-level rows that hide mixed behavioral/incidental anchors in the same file.
- Output schema (tabular, one row per anchor): `row-id` (stable, unique), `test-path`, `case-scope`, `guarded-invariant`, `anchor-mechanism`, `classification` (`behavioral` | `incidental`), `disposition` (`re-key` | `stay-incidental` | `n/a` for behavioral), `stay-incidental-rationale` (required when disposition is `stay-incidental`), `vacuous-pass-risk` (`yes` | `no`, required when mechanism is one-way absence or can pass vacuously); rules out prose-only invariant lists without referencable row ids.
- Classification rubric (tie-break): **behavioral** = invariant would still hold after sound rename/move/reorder without changing observable test outcome; **incidental** = anchor is symbol name, line number, hand-maintained file list, copied registry literal, or one-way absence without paired presence check; baseline guidance in `v2/spec/seeds/structural-invariants-key-on-behavior-not-incidental-structure.md`; rules out ad-hoc per-row judgment without rubric.
- Incidental rows default to disposition `re-key`; `stay-incidental` requires a one-line rationale naming why the anchor cannot track the source of truth; rules out silent incidental pins.
- Completeness is manifest reconciliation against script output: every `in-scope` file has ≥1 inventory row, every inventory row cites a file the script emitted `in-scope`. Rules out partial inventories that tick "every anchor" without a falsifiable, re-runnable check.
- Illustrative seed examples from [[structural-invariants-key-on-behavior-not-incidental-structure]] (`execution-terminal-settlement-guard.test.ts`, `daemon-test-inventory.test.ts`, `workflow-runner-resume-inventory.test.ts`, `workflow-runner-resume-structure.test.ts`, `diff-derived-mutation-verifier.test.ts`, `daemon-workflow-start.test.ts`, `module-boundary-surfaces.test.ts` plan-draft classifier) are discovery hints only, not completeness checkpoints; the script must emit each of them `in-scope` on its own rules, which is a test, not a hardcoded list. Rules out false-green when a seed file is missed and rules out special-casing the seed's examples into the script.
- Methodology section documents excluded trees (`v1/**`, `scripts/**`, `test/**`, fixture-only reads, `*.test-support.ts`) with one-line rationale each; rules out repo-wide structural-debt readings.
- The script is the foundation for a CI drift guard over new structural tests; wiring that guard is deferred to the re-key work, but the discovery mechanism is no longer deferred with it.

## Task checklist

- [ ] Add `scripts/discover-structural-invariant-tests.ts` implementing rules A/B/C over `v2/src/**/*.test.ts` and `shared/**/*.test.ts`, emitting one manifest row per file with its matched rule name (or `no-structural-signal`).
- [ ] Add a co-located test for the script covering each rule matching, each rule not matching, and the seed's example files landing `in-scope` via rules rather than a hardcoded list.
- [ ] Create `v2/docs/structural-invariant-test-audit.md` with the methodology section: in-scope definition, excluded trees with rationales, the three discovery rules, output schema, classification rubric, manifest reconciliation rules, and how to re-run the script.
- [ ] Embed the script's manifest output verbatim in the artifact.

## Acceptance criteria

- [x] `scripts/discover-structural-invariant-tests.ts` exists and emits one row per `v2/src/**/*.test.ts` and `shared/**/*.test.ts` file, each `in-scope` with a matched rule name (`source-read` | `registry-mirror` | `structural-name`) or `out-of-scope` with `no-structural-signal`.
- [x] The new script test `discovery emits in-scope for a source-reading test file` asserts a fixture referencing `readFileSync` on a production path is `in-scope` via `source-read`; it fails if rule A is dropped.
- [x] The new script test `discovery emits in-scope for a registry-mirroring test file` asserts a fixture holding a literal mirrored against a production registry is `in-scope` via `registry-mirror`; it fails if rule B is dropped.
- [x] The new script test `discovery emits out-of-scope for a purely behavioral test file` asserts a fixture with no structural signal is `out-of-scope` with `no-structural-signal`; it fails against a scanner that marks every file in-scope.
- [x] The new script test `discovery classifies every seed example file in-scope by rule` asserts each of the seven seed-named files is `in-scope` and names its matching rule, with no file-path allowlist in the script source; it fails against a script that special-cases them.
- [x] `v2/docs/structural-invariant-test-audit.md` methodology matches **Decisions**: scope, excluded trees with rationales, the three rules, output schema, classification rubric, manifest reconciliation, and the re-run command.
- [x] The artifact embeds the script's manifest output covering every `v2/src/**/*.test.ts` and `shared/**/*.test.ts` file.
- [x] `bun run typecheck` and the `test:v2` pair pass.

## Documentation updates

- `v2/docs/structural-invariant-test-audit.md` — the durable artifact for this intent (methodology, manifest, and the inventory subspecs 01–04 append to).
