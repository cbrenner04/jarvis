# 01 - Add agent invocation outcomes and quota fallback

## Decisions

- Put Phase 1 agent selection and fallback inside the invocation layer, not the CLI host and not the output-contract checker.
- Reuse the existing agent order concept as an invocation-layer concern; keep Phase 1 configuration surface to the minimum needed to choose the effective order for this one step.
- Classify invocation outcomes into `done`, `blocked`, `progress`, quota-exhausted, and non-quota process failure.
- Advance to the next agent only on quota exhaustion; `blocked`, `progress`, and non-quota process failure stop the run immediately.
- Treat a non-zero process result as fallback-eligible only when the existing quota-detection heuristics classify it as quota exhaustion; do not invent broader retry rules.
- Surface `progress` from invocation to the runner unchanged; Phase 1 stops non-success without retry because loop semantics are deferred.
- Surface `blocked` from invocation to the runner unchanged; blocked is terminal and not fallback-eligible.
- Treat non-quota process failure as terminal failure even if later agents remain in the order; silent fallback would hide real breakage.
- Keep the invocation result inspectable by the runner without reading agent transcript text; fallback decisions must rest on closed outcome classifications.
- Cancellation via `AbortSignal` must interrupt the active invocation attempt and stop further fallback attempts.
- Deferred to first consumer: whether invocation captures richer structured failure payloads beyond the closed classifications needed for fallback — pin when structured logs arrive.

## Constraints

- Keep the subspec limited to invocation semantics and fallback; do not pull worktree creation, artifact verification, or CLI contract sprawl into this slice.
- Reuse existing quota heuristics where they already exist; do not redesign per-agent signal detection in Phase 1 unless a seam is needed to call it from v2.
- Keep fallback host-agnostic so a later daemon host can reuse it unchanged.

## Assumptions

- Phase 1 has exactly one concrete `write` step, so invocation does not need per-step workflow binding semantics yet.
- A local-model terminal fallback and configurable order expansion remain future concerns unless the minimal Phase 1 surface needs a seam to avoid rewiring later.

## Task checklist

- Define the invocation outcome taxonomy Phase 1 needs for runner decisions.
- Define quota-fallback eligibility precisely and limit it to quota exhaustion.
- Define cancellation behavior across fallback attempts.
- Define the minimal reuse seam for existing quota-detection and agent-launch plumbing.

## Acceptance criteria

- [ ] The spec defines a closed invocation outcome taxonomy that separates `blocked`, `progress`, quota exhaustion, terminal `done`, and non-quota process failure.
- [ ] The spec states that only quota exhaustion advances to the next agent in the effective order and that every other outcome class stops the Phase 1 run without retry.
- [ ] The spec states that non-quota process failures are terminal even when later agents remain in the order and that fallback never masks ordinary execution breakage.
- [ ] The spec states that `progress` is surfaced as a non-success runner outcome without retry and that `blocked` is surfaced as terminal blocked without fallback.
- [ ] The spec requires the invocation layer to expose machine-checkable classifications to the runner so fallback decisions do not depend on transcript parsing.
- [ ] The spec requires `AbortSignal` cancellation to stop the active attempt and suppress any further fallback attempts.
- [ ] The spec identifies which existing quota-detection or agent-launch seams are reused and keeps any new v2 seam host-agnostic and minimal.

## Documentation updates

- None in this subspec; durable doc alignment for the shipped Phase 1 path lands with the end-to-end materialization slice in `02`.
