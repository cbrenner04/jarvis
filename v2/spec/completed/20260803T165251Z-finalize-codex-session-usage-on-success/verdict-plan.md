# Verdict: Required refinements

The spec is appropriately scoped (one seam, one subspec) and the core behavior is sound. These refinements are required before merge:

## 1. Restate the malformed-rollout acceptance criterion at the finalize seam

The current “unreadable or malformed matched rollout” criterion targets cases the resolver never delivers: unreadable files are skipped during resolution, and fully malformed files fail the token-count probe. The reachable finalize cases are **partially parseable rollouts with bad `info` / `total_token_usage` shape** (or otherwise unextractable non-null `info` events).

**Required:** Rewrite that AC to describe finalize-level degradation (bad usage shape → `usage_source: "unavailable"`, `cost_source: "no-usage"`, warning, no throw). Drop “unreadable” unless the spec names a concrete injection hook that puts an unreadable file on the matched path.

## 2. Define the usage-mapping contract (mirror v1 `extractTokenUsage` semantics)

Shared’s session matcher accepts rollouts v1 would reject. The spec’s naked `input_tokens - cached_input_tokens` is insufficient: missing fields, `cached > input`, and non-object `total_token_usage` can produce wrong usage or negative cost.

**Required:** Add a Decisions line that the mapper mirrors v1 semantics: per-field `numberOrNull`, `Math.max(0, input - cached)` for billable input, `cache_creation_input_tokens: null`, non-object `total_token_usage` treated as no usage. Clarify that mapped fields all null settles `usage_source: "agent"` + `cost_source: "no-usage"` (cursor precedent), distinct from the all-`info: null` branch.

## 3. Pin “last non-null `info`” with a non-monotonic fixture and document rationale

The decision (terminal cumulative `total_token_usage` = session total) is defensible but unstated. AC #3 as described (monotonic totals) does not distinguish last-wins from v1 max-total.

**Required:** (a) Add rationale in Decisions for last-event-over-max-total. (b) Change the multi-event fixture to include a **decreasing** final non-null total plus a **trailing `info: null` `token_count`** so only last-wins passes.

## 4. Scope error handling so mutation checkpoints are verifiable

A broad try/catch around finalize swallows mapping failures from an inverted `info` guard, yielding the same `unavailable`/`no-usage` as the all-null test → mutation goes green and the harness refuses it.

**Required:** Decide and document that degrade-without-throw applies only to **file read + JSONL parse** (mapping/shape errors surface or follow the explicit no-usage path). Align the info-guard `@mutate` with an outcome that differs from the all-null case (e.g., zero-token `usage_source: "agent"` if the guard is removed).

## 5. Warn on all-`info: null` matched rollouts

On match, `resolved.warnings` is empty. All-null `info` settling `unavailable` + `no-usage` with no warning is indistinguishable from a correlation miss in telemetry—especially after the warnings prerequisite landed for exactly this.

**Required:** Add a warning on the all-null-info branch (malformed branch already has one; keep them consistent in intent).

## 6. Specify success-path field preservation

Codex finalize must decide whether to spread the existing `InvocationOk` or rebuild it (cursor rebuilds and drops fields). Codex’s degrade branches carry warnings; the success path must state what is preserved from `runAgent`’s ok result.

**Required:** One Decisions line on spread-vs-rebuild for the priced success path.

## 7. Complete shared-surface verification list

`shared/**` changes require six test scripts per `ci-test-scope.ts`; the AC lists five and omits `test:integration:v1` and `test:integration:shared`.

**Required:** Add both to the final verification AC and Tasks.

## 8. Assert end-to-end telemetry for priced usage

The intent problem is invisible metered spend in telemetry. Unit assertions on `runCodexBinding` alone do not prove rows carry usage/cost. Cursor’s sibling test drives `executeWithQuotaFallback` and asserts `rows[0]`.

**Required:** Extend the priced-usage AC (or add one) with a telemetry-row assertion for `usage_source`, mapped usage, `cost_source`, and `cost_usd`.

## 9. Decouple cost assertion from brittle exact equality

Hardcoding `0.135824` couples the test to a live `prices.json` row while price edits are out of scope.

**Required:** Use tolerance-based assertion (e.g. `toBeCloseTo`) with the computed value documented; note the catalog coupling.

---

**Not required:** Splitting the subspec; changing the `@mutate` target uniqueness argument for the finalize-call mutation (target is the unique finalize call, not `return result;`); expanding AC #6 beyond citing the existing unmatched-session preservation test—the advocate’s “marker-miss / multiple-match share the same branch” rationale is sufficient.

**Preservation AC:** Keep `codex session usage unavailable remains ok with warning metadata` stays green as written (behavior-preserving citation pattern).