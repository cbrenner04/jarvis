# 00 - Extract shared prompt and agent invocation plumbing

## Decisions

- Promote only the shared seams that Phase 1 calls live: prompt registry load/lookup/render and behavior-agnostic agent invocation.
- Keep the extraction root-shared, not `v2/**`, because `jarvis1` must keep using the same prompt source and fallback policy.
- Keep the invocation surface host-agnostic: `(prompt, cwd, ordered bindings, signal) -> ok | quota | error`.
- Preserve v1 quota fallback semantics exactly: advance only on quota-classified outcomes in the effective order.
- Stop immediately on non-quota failures: hard error, model-config error, timeout, or abort.
- Keep token parsing, contract dispatch, worktree naming, and write behavior wiring out of this subspec.
- Refactor shared code to the v2 bar instead of preserving v1 file shapes behind shims.
- Add the first live `write.execute` prompt artifact in top-level `prompts/` in the same extraction that makes it renderable.
- Keep prompt registration explicit through the shared seed list; do not add path scanning.
- Deferred to first consumer: the exact binding object shape beyond the fields needed to invoke one configured agent — pin when a second caller needs more.

## Constraints

- Do not add a v2-local prompt loader or registry contract.
- Do not import `v2/**` from `v1/**` or `v1/**` from `v2/**`.
- Do not add workflow, step-runner, or worktree concerns here.
- Keep the shared API abortable with `AbortSignal`.
- Keep `jarvis1` prompt snapshots green in the same change because shared prompt rendering is shared behavior.

## Task checklist

- Extract one root-shared prompt registry surface used by both engines.
- Add `write.execute` to top-level `prompts/` through the explicit seed list.
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
- Add one `v2/docs/` contract note for shared invocation only if no existing durable doc owns that boundary.
