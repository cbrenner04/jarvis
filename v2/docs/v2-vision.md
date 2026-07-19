# Jarvis v2 — Vision

Long-lived reference: the *why* behind v2 and the constraints and guiding principles that govern its design. The decided architecture — the *how* — lives in [`v2-architecture.md`](v2-architecture.md). The executed rollout material (repo split, binary rename, behavior catalog, build order, coexistence plan) is retired; v2 (`jarvis`) is the primary engine and v1 (`jarvis1`) the maintenance-only fallback.

## Guiding principles

- **Behavior is the source of truth.** v1's *implementation* is mostly disposable; its *behaviors and user workflows* are what v2 must preserve.
- **Documented in code.** Follow the operational standard in [`documentation-standard.md`](documentation-standard.md): doc-comment exported symbols and document each behavior in one durable home. Separate higher-level docs keep the big picture coherent.
- **Tests beside v2 source.** Co-located under `v2/src/<domain>/`; no `v2/test/` mirror of `v2/src/`. Other fixtures stay near owning code unless shared. [`Source layout`](v2-architecture.md#source-layout).
- **Composable over modal.** "mode" (plan / patch / review / yolo) is not a source-code primitive — modes are user-defined workflow presets composed from a small behavior vocabulary. Settled; the concrete model lives in [`v2-architecture.md`](v2-architecture.md).
- **No tech-stack churn.** bun + biome + typescript stay.
- **Be terse.** Verbosity costs money and review effort. Minimize it across planning, implementation, and review — in Jarvis source and target repos alike. If verbosity can drop with near-identical outcomes, drop it.
- **Strong architectural decisions.** Even in YOLO, outcomes rest on considered architecture, never "just get it working" — that only causes more iterations, which is neither cost-effective nor terse.
- **Prompts are first-class code.** Versioned, reusable, reviewed — shared top-level `prompts/` read by both engines, so prompt improvements reach v1 too. As-shipped contract: [`../../v1/docs/prompt-governance.md`](../../v1/docs/prompt-governance.md).

## Architectural constraints

Constraints v2's architecture must satisfy; the architecture is checked against all of them.

- **Subspec ≈ PR, capped.** Every subspec compiles to a PR under 1000 lines, with ~600 as the sweet spot. v2's planner has to decompose work into chunks that hit that ceiling. The cap should be configurable, not hardcoded — different projects may want different ceilings.
- **Structured logging.** First-class, structured, queryable — not ad-hoc stdout. The runtime should produce a log stream that something else can consume.
- **A long-running server.** A host process that hosts orchestrations rather than each run living in its own terminal window. v2's core should be embeddable, not assume a one-shot CLI lifecycle.
- **An orchestration UI.** One interface to launch, monitor, and steer many concurrent jarvis runs. Implies a programmatic surface (API/IPC) over each operation, not just CLI flags.
- **Cost-efficient.** Workflows can chain many agent calls. Optimize prompts, agent choice, and orchestration to hit the target without wasted agent use. Anything that can be deterministic should be.
- **Memory-efficient.** Concurrent agents plus a local model must not bog down the machine. Drives the adaptive admission and on-demand local model in `v2-architecture.md`.
- **Configurable.** If something shouldn't be hardcoded, it belongs in config (the data layer). Don't ignore that instinct.
- **Models separate from agents.** The fallback hierarchy exists for *agents* (availability/quota); models are a separate axis that always attach to a specific agent. v2 keeps them apart: a per-machine agent fallback order, and a machine-independent role→model store a step selects by **role**. v1's combined `{agent, model}` list is deliberately not carried forward. Detail in [`v2-architecture.md`](v2-architecture.md) and [`role-resolution.md`](role-resolution.md).
- **Composable.** Different projects need different postures — sensitive projects want more review steps, others run YOLO — and even sensitive projects don't need a full plan/review cycle for every small change.
- **Extendible.** Changes should be easy to make and easy to review. Cheaper, and it builds trust in them.
- **Reliable.** Unit-test business logic; measure coverage and block on drops; integration-test workflows. Evals (on-demand only, with heuristics for when to run) catch outcome drift — deferred for now.
