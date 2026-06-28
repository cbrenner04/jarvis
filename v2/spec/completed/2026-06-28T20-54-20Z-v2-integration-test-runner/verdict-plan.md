## Verdict: required refinements

### 1. Resolve `test-slices.test.ts` conflict with changing `test:v2`

The spec changes `test:v2` but does not address `test:* scripts use exact root paths with trailing slashes`, which pins `test:v2` to `bun test ./v2/`. An implementer will hit a red test with no migration path.

**Required:** Tasks and ACs must state that exact-string pinning stays for `test:v1` and `test:shared` only; `test:v2` moves to file-set boundary assertions (not script-string equality).

### 2. Record the trailing-slash invariant tradeoff

`test-slices.test.ts` pinned bare `bun test ./v2/` to prevent substring cross-contamination. Excluding by filename breaks that contract.

**Required:** A Decisions entry that v2 agent-runnable collection is enforced by file-set regression under `v2/**`, not exact `test:v2` script-string equality — rules out reverting to directory-only invocation without exclusion.

### 3. Tighten scope: `test:v2` fixed; aggregate gate unchanged

The problem statement implies sandbox agent runs are fixed broadly; intent explicitly leaves `test` and `ready` unchanged. Aggregate `bun run test` still collects v2 sandbox-unrunnable files today.

**Required:** Problem statement names `test:v2` as the fixed surface. A Decisions entry records aggregate `bun run test` / `ready` still collect v2 sandbox-unrunnable files — rules out repo-wide gate churn in this slice.

### 4. Decide or defer `coverage:v2` asymmetry

`coverage:v2` is `bun test --coverage ./v2/` and would still include integration files after `test:v2` excludes them. Neither intent nor spec records intent.

**Required:** Either (a) a Decisions entry leaving `coverage:v2` whole-v2 unchanged with doc note of intentional asymmetry vs `test:v2`, or (b) `Deferred to first consumer: whether coverage mirrors the test split — pin when coverage gates need slice parity`.

### 5. Anchor collection-pinning AC to concrete verification

AC #3 ("pins boundaries") is unanchored vs the preservation AC citing `ready script uses aggregate test command`.

**Required:** Rewrite AC #3 so it cites the `test-slices.test.ts` case(s) that must change and requires enumerated file-set comparison for `test:v2` and `test:integration:v2` — not `package.json` substring checks alone.

### 6. Bidirectional collection ACs against on-disk inventory

Current ACs forbid false positives only. A broken glob or over-broad exclusion could pass with zero or partial matches.

**Required:** ACs that `test:v2` collects every `v2/**/*.test.ts` except `*.sandbox-unrunnable.test.ts`, and `test:integration:v2` collects every `v2/**/*.sandbox-unrunnable.test.ts`, verified by enumeration against the repo inventory (three files under `v2/src/` today).

### 7. Collection scope: all depths under `v2/`

Pattern `./v2/**/*.sandbox-unrunnable.test.ts` may miss files placed directly under `v2/` depending on glob semantics.

**Required:** Decisions or AC language scopes collection to all `*.sandbox-unrunnable.test.ts` under `v2/` regardless of depth — rules out glob-only matching that skips shallow files.

### 8. Deepen `test-writing.md` operator routing

AC #6 documents the split but not where authors run integration tests. Per `documentation-standard.md`, the Real-process / real-clock tests section is the durable home for filename-marker conventions.

**Required:** Doc task/AC extends that section with run commands: `test:integration:v2` (sandbox-off), excluded from `test:v2`, and still included in aggregate `bun run test`.

### 9. Coverage doc alignment (coupled to #4)

If `coverage:v2` stays whole-v2, `v1/docs/test-coverage.md` and/or `v1-behaviors.md` must record the intentional asymmetry with `test:v2`. If deferred, the deferral belongs in Decisions.

**Required:** Documentation updates section names the doc target for whichever #4 outcome is chosen.

### 10. Clarify AC #5 preservation scope

AC #5 beside behavioral collection ACs reads like "change nothing except add a script" while silently exempting `test:v2`.

**Required:** Rephrase to state `test:v1` and `test:shared` script values unchanged; `test:v2` may change to implement exclusion.

---

**Not required for merge:** explicit `--parallel` absence test beyond behavioral AC #2; `v1/docs/operator-runbook.md` update (optional cross-link if desired); prerequisites section (inventory is observable; #6 covers it).
