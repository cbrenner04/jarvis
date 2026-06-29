# Phase 5 phase-tracking doc alignment

## Problem

`v2/docs/v2-build-order.md` and `v2/spec/v2-meta-index.md` still describe Phase 5
with retired `category→agent→model` semantics. Role-based resolution is documented
in `v2/docs/role-resolution.md` and `v2/docs/agent-model-config.md`; phase
tracking must match and state the design dependency before Phase 5 planning or
implementation proceeds.

## Prerequisites

- Role keys are documented as v2 invocation-resolution keys (replacing
  thinking/reviewing/executing categories) in `v2/docs/role-resolution.md`.
- `AgentModelConfig` schema and per-agent per-role model escalation are documented
  in `v2/docs/agent-model-config.md`.

## Decisions

- **Phase 5 contract is role→model, not categories** — steps name a closed `Role`;
  runner resolves `(agent, role) → rungs` from `AgentModelConfig` — rules out
  keeping `thinking` / `reviewing` / `executing`, `category→model store`,
  `steps name categories`, or `category→agent→model` as the phase contract.
- **Design gate is explicit in both tracking docs** — Phase 5 does not proceed
  against retired category taxonomy; consumes `role-resolution.md` +
  `agent-model-config.md` committed on `main` — rules out silent assumption that
  category docs still govern.
- **Advisory design gate only** — "blocked" is explicit prose dependency in
  tracking docs; no harness/plan/run mechanical gate — rules out scope creep into
  workflow enforcement.
- **`role-resolution.md` deferral retracted** — remove or revise the
  `v2-build-order.md refresh deferred` decision when build-order is updated —
  rules out leaving a deferral that contradicts this subspec and single-home doc
  policy.
- **Cross-cutting Phase 5 forward refs updated** — Phase 1 and Quota fallback
  bullets that name the Phase 5 store use role→model wording and role-based
  resolution composition (outer agent fallback, inner rungs per
  `agent-model-config.md`) — rules out leaving stale `category store` /
  `category→agent→model` / `category→model store` elsewhere in the same file
  while Phase 5 section is fixed.
- **Phase 6 debate-class prose unchanged** — `reviewing-class` / `executing-class`
  in `### Phase 6` debate-structure prose only describe debate structure, not
  model-resolution keys — rules out scope creep into other Phase 6 wording.
- **`v2-vision.md` shorthand preserved** — vision may keep `(agent, role) → model`;
  build-order follows `agent-model-config.md` precision `(agent, role) → rungs` —
  rules out treating vision line as blocking inconsistency or requiring vision edit
  in this subspec.
- **Phase ordering and scope unchanged** — only agent/model resolution wording and
  the design gate note — rules out reordering phases or expanding Phase 5 deliverables.

## Task checklist

- Update `v2/docs/v2-build-order.md` Phase 5 section: role→model store,
  `(agent, role) → rungs`, steps name `role`, hard error on missing required
  `(agent, role)` at load; add design-gate note citing `role-resolution.md` and
  `agent-model-config.md` on `main`; remove Retires-clause category-as-resolution-key
  prose (`steps name categories`, `category→model store`).
- Update Phase 1 forward reference (`category store is Phase 5`) to role→model
  store.
- Update Cross-cutting Quota fallback bullets: role→model store; role-based
  resolution composition (outer agent fallback, inner rungs per
  `agent-model-config.md`).
- Update `v2/spec/v2-meta-index.md` Phase 5 line to match build-order contract
  tokens and note the design dependency on `main`.
- Retract or revise `v2-build-order.md refresh deferred` in
  `v2/docs/role-resolution.md`.
- Remove `category`, `thinking`, `reviewing`, and `executing` as model-resolution
  keys from Phase 5 prose in both files (`reviewing-class` / `executing-class` in
  `### Phase 6` debate-structure prose exempt).

## Acceptance criteria

- [ ] `v2/docs/v2-build-order.md` Phase 5 section names a machine-independent
      **role→model store** (not `category→agent→model` or `category→model store`);
      steps name a **role** (not categories); runner resolves `(agent, role) →
      rungs`; missing required `(agent, role)` is a hard error at load; Retires
      clause contains no category-as-resolution-key phrasing.
- [ ] `v2/docs/v2-build-order.md` Phase 5 section states Phase 5 planning and
      implementation depend on `role-resolution.md` and `agent-model-config.md`
      committed on `main` and must not use retired category taxonomy.
- [ ] `v2/docs/v2-build-order.md` Phase 1 forward reference names a **role→model
      store** (not category store).
- [ ] `v2/docs/v2-build-order.md` Cross-cutting Quota fallback bullets name a
      **role→model store** and role-based resolution composition (outer agent
      fallback, inner rungs per `agent-model-config.md`), not category-based
      composition.
- [ ] `v2/docs/v2-build-order.md` contains no `category→agent→model`,
      `category→model store`, `category store`, or steps-name-a-category wording
      outside `reviewing-class` / `executing-class` in `### Phase 6`
      debate-structure prose.
- [ ] `v2/spec/v2-meta-index.md` Phase 5 line encodes role-named steps,
      role→model store (not category store), `(agent, role) → rungs`, and hard
      error on missing required `(agent, role)` at load.
- [ ] `v2/spec/v2-meta-index.md` Phase 5 line states the design dependency on
      `role-resolution.md` and `agent-model-config.md` committed on `main`.
- [ ] `v2/docs/role-resolution.md` no longer defers `v2-build-order.md` refresh;
      the `v2-build-order.md refresh deferred` decision is retracted or revised.

## Documentation updates

- `v2/docs/v2-build-order.md` — Phase 5 section (including Retires clause), Phase 1
  forward ref, Cross-cutting Quota fallback bullets.
- `v2/spec/v2-meta-index.md` — Phase 5 line and design gate note.
- `v2/docs/role-resolution.md` — retract or revise `v2-build-order.md refresh
  deferred` decision.
