# 00 - Shared prompts and invocation

## Decisions

- Promote only the seams Phase 1 calls: prompt registry load/lookup/render and behavior-agnostic agent invocation.
- Keep the extraction root-shared; `jarvis1` and v2 must share prompt source and fallback policy.
- Keep invocation host-agnostic: `(prompt, cwd, ordered bindings, signal) -> ok | quota | error`.
- Preserve v1 quota fallback exactly: advance only on quota outcomes in effective order.
- Stop on non-quota failures: hard error, model-config error, timeout, or abort.
- Keep token parsing, contract dispatch, worktree naming, and write wiring out of this subspec.
- Refactor to the v2 bar; do not preserve v1 file shapes behind shims.
- Add `write.execute` in top-level `prompts/` in the same change that makes it renderable.
- Keep prompt registration explicit via the shared seed list; no path scanning.
- Deferred to first consumer: binding shape beyond fields needed for one configured agent — pin when a second caller needs it.

## Constraints

- No v2-local prompt loader or registry contract.
- No `v2/** -> v1/**` or `v1/** -> v2/**` imports.
- No workflow, step-runner, or worktree concerns here.
- Keep the shared API abortable with `AbortSignal`.
- Keep `jarvis1` prompt snapshots green in the same change.

## Task checklist

- Extract one root-shared prompt registry surface for both engines.
- Add `write.execute` to top-level `prompts/` via the explicit seed list.
- Extract one shared invocation layer with ordered-binding quota fallback.
- Add focused prompt-render and fallback tests.
- Update only the durable homes this slice changes.

## Acceptance criteria

- [ ] Root-shared prompt code owns load, lookup, and render behind one cohesive API consumed by both `jarvis1` and v2, with no `v2/** -> v1/**` or `v1/** -> v2/**` import.
- [ ] A top-level prompt artifact with stable ID `write.execute` is registered through the explicit seed list and renders through the shared registry.
- [ ] The shared invocation layer accepts ordered agent bindings plus `cwd` and `AbortSignal`, returns typed `ok | quota | error` outcomes, and contains the only quota-fallback loop used by the Phase 1 path.
- [ ] Quota fallback advances only on quota-classified outcomes and preserves the effective binding order; non-quota failures stop immediately without trying later bindings.
- [ ] Existing jarvis1 prompt rendering coverage and any new shared invocation tests pass after the extraction.

## Documentation updates

- Update `v2/docs/prompts.md` only if the shared prompt inventory or registry boundary changes.
- Add one `v2/docs/` contract note for shared invocation only if no durable doc already owns that boundary.
