# Phase 5 phase-tracking doc alignment

## Problem

`v2/docs/v2-build-order.md` and `v2/spec/v2-meta-index.md` still describe Phase 5
with retired `category→agent→model` semantics. Role-based resolution is documented
in `v2/docs/role-resolution.md` and `v2/docs/agent-model-config.md`; phase
tracking must match and state the design dependency before Phase 5 planning or
implementation proceeds.

## Decisions

- **Phase 5 contract is role→model, not categories** — steps name a closed `Role`;
  runner resolves `(agent, role) → rungs` from `AgentModelConfig` — rules out
  keeping `thinking` / `reviewing` / `executing` or `category→agent→model` as the
  phase contract.
- **Design gate is explicit in both tracking docs** — Phase 5 does not proceed
  against retired category taxonomy; consumes merged `role-resolution.md` +
  `agent-model-config.md` — rules out silent assumption that category docs still
  govern.
- **Cross-cutting Phase 5 forward refs updated** — Phase 1 and Quota fallback
  bullets that name the Phase 5 store use role→model wording — rules out leaving
  stale `category store` / `category→agent→model` elsewhere in the same files
  while Phase 5 section is fixed.
- **Phase 6 behavior prose unchanged** — `reviewing-class` / `executing-class` in
  Phase 6 describe debate structure, not model-resolution keys — rules out
  scope creep into Phase 6 wording.
- **Phase ordering and scope unchanged** — only agent/model resolution wording and
  the design gate note — rules out reordering phases or expanding Phase 5 deliverables.

## Task checklist

- Update `v2/docs/v2-build-order.md` Phase 5 section: role→model store,
  `(agent, role) → rungs`, steps name `role`, hard error on missing required
  `(agent, role)` at load; add design-gate note citing `role-resolution.md` and
  `agent-model-config.md`.
- Update Phase 1 forward reference (`category store is Phase 5`) to role→model
  store.
- Update Cross-cutting Quota fallback bullets that reference the Phase 5 store.
- Update `v2/spec/v2-meta-index.md` Phase 5 line to match build-order semantics
  and note the design dependency.
- Remove `category`, `thinking`, `reviewing`, and `executing` as model-resolution
  keys from Phase 5 prose in both files (Phase 6 debate-class wording exempt).

## Acceptance criteria

- [ ] `v2/docs/v2-build-order.md` Phase 5 section names a machine-independent
      **role→model store** (not category→agent→model); steps name a **role**;
      runner resolves `(agent, role) → rungs`; missing required `(agent, role)`
      is a hard error at load.
- [ ] `v2/docs/v2-build-order.md` Phase 5 section states Phase 5 planning and
      implementation depend on merged role-based design (`role-resolution.md`,
      `agent-model-config.md`) and must not use retired category taxonomy.
- [ ] `v2/docs/v2-build-order.md` contains no `category→agent→model`,
      `category store`, or steps-name-a-category wording outside Phase 6
      debate-class prose.
- [ ] `v2/spec/v2-meta-index.md` Phase 5 line matches build-order role→model
      semantics (role-named steps, role→model store, not category store).
- [ ] `v2/spec/v2-meta-index.md` Phase 5 line notes the design dependency on
      merged `role-resolution.md` and `agent-model-config.md`.

## Documentation updates

- `v2/docs/v2-build-order.md` — Phase 5 section, Phase 1 forward ref, Cross-cutting
  Quota fallback bullets.
- `v2/spec/v2-meta-index.md` — Phase 5 line and design gate note.
