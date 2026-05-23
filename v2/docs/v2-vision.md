# Jarvis v2 — Vision

This is a long-lived reference doc, not a plan intent. It captures the *why*, the rollout strategy, and the constraints and guiding principles for the v2 rewrite. The decided architecture — the *how* — lives in [`v2-architecture.md`](v2-architecture.md). Individual v2 work items live as their own intents and reference these docs.

## Repo layout (target)

One package, multiple source trees. A single root `package.json`, `bun.lock`, and `node_modules` for the whole repo. v1 and v2 are separate TypeScript projects (separate source trees that cannot import each other), not separate packages.

```text
package.json
bun.lock
node_modules
biome.json
tsconfig.base.json    # repo-wide tool config
bin/jarvis1 -> v1     # after rename
prompts/              # first-class, treated as code — shared by both engines
v1/                   # engine v1 (own tsconfig project)
  src/
  test/
  spec/
  docs/
v2/                   # engine v2 (own tsconfig project)
  src/                # source and co-located *.test.ts files
  spec/               # v2 specs + work-seed intents (wip-intents/)
  docs/               # long-lived v2 reference docs (vision, architecture, ...)
```

Prompts are a top-level peer, not owned by either engine (see "Core premise" and the prompts intent).

## Guiding principles

- **Behavior is the source of truth.** v1's *implementation* is mostly disposable; its *behaviors and user workflows* are what v2 must preserve.
- **Documented in code.** Inline documentation is a first-class output, not an afterthought. Separate higher-level docs keep the big picture coherent.
- **Tests beside v2 source.** v2 tests live next to the source they cover instead of in a parallel `v2/test/` tree. Keep test-only fixtures near their owning code unless a genuinely shared fixture earns a shared home.
- **Composable over modal.** "mode" (plan / patch / review / yolo) is not a source-code primitive — modes are user-defined workflow presets composed from a small behavior vocabulary. Settled; the concrete model lives in [`v2-architecture.md`](v2-architecture.md).
- **No tech-stack churn.** bun + biome + typescript stay.
- **Be terse.** Verbosity costs money and review effort. Minimize it across planning, implementation, and review — in Jarvis source and target repos alike. If verbosity can drop with near-identical outcomes, drop it.
- **Strong architectural decisions.** Even in YOLO, outcomes rest on considered architecture, never "just get it working" — that only causes more iterations, which is neither cost-effective nor terse.

## Naming clean-up

- `run` / "patch mode" → `implement`. Drop both "run" and "patch".

## Prompts as first-class artifacts

If English is code, prompts deserve the same treatment as code: versioned, reusable, reviewable, not buried inline — arguably the most important pieces in the repo. Decided so far:

- Prompts live in a **shared top-level `prompts/`** that both engines read from, abstracted out of v1 and v2.
- v1 reads those **shared, evolving** prompts. "Reliable jarvis1" means a stable *engine*, not frozen prompt text — prompt improvements reach v1 too, and there is one source of truth rather than duplicated copies.

Designed and shipped (#121/#122): the `prompts/` layout, the prompt artifact taxonomy, the rendering/placeholder contract, and the review/testing standard. Because v1 shares evolving prompts, rendered-prompt snapshot tests guard `jarvis1` output — a prompt edit that shifts rendered output is visible and reviewed via revision-keyed snapshots. The canonical as-shipped contract is [`../../v1/docs/prompt-governance.md`](../../v1/docs/prompt-governance.md); the design intent lives in [`prompts.md`](prompts.md).

## Composability direction

The current "mode" model breaks down under the next round of features:

- **review** is a capability to add, but review wants to run *throughout* a plan or implement flow, not stand alone alongside them. That makes it not-a-mode in the same sense plan/implement are.
- **yolo** is plan + implement + review composed. If yolo is a mode, then modes-compose-modes, which means "mode" is really just "named pipeline of operations."
- The right primitive is composable behavior loops plus a **host/runner** that orchestrates them. Modes become user-defined workflow presets, not a distinct kind of source-code entity.

### Behavior loops as interchangeable workflow pieces

The composability target is not only "modes are pipelines." It is that the repeated pieces inside today's modes become explicit, interchangeable **behaviors**. A behavior is the loop primitive: what kind of work is being repeated, who performs it, and how the runner decides whether to continue or stop. Model selection, prompt selection, artifact contracts, and write boundaries specialize that primitive into concrete workflow steps.

Useful behavior shapes:

- **Write loop**: run an agent until a requested artifact exists, acceptance criteria move, or a blocker is declared. Model + prompt + artifact contract turn this into concrete steps such as create-intent, draft-spec, or implement-code.
- **Review and update loop**: run an agent against existing artifacts, critique them, and update them in place. Model + prompt + artifact contract turn this into concrete steps such as refine-intent, review-spec, implementation-review, or security-review.
- **Human loop**: pause automation for human review, approval, edits, merge, or an explicit resume command. v2 should make this less clunky than today, but the core architecture should not depend on brittle external resume conditions from day one.

Workflows should stay mostly linear. A workflow is an ordered list of behavior steps with bounded repeat patterns, not an arbitrary graph. It should be possible to repeat a previous range of steps a fixed number of times, such as "repeat spec review + human review up to `N` times," while avoiding free-form branching that could make workflows surprising or hard to reason about.

Loop counts are maximums. A workflow can force the full maximum when desired, but agent-driven loops may be allowed to stop early after a minimum number of passes when the agent reports that no useful work remains. That early-stop path needs an explicit outcome, not silent agent discretion.

Plan mode today can be described as a fixed composition of those behavior loops:

1. "Write" loop 1 time with an intent-creation prompt.
2. "Review and update" loop `N` times with an intent-refinement prompt.
3. "Human" loop `N` times for intent approval.
4. "Write" loop 1 time with a draft-spec prompt.
5. "Review and update" loop `N` times with a spec-review prompt.
6. "Human" loop `N` times for final review and merge.

Different projects should be able to choose different compositions without changing the underlying behavior implementations. A lightweight project might run only steps `1, 3, 4, 6`. A stricter project might run `1-6`, then repeat spec review + human review (`5, 6`) until the spec is accepted. The same behavior pieces are reused; only the workflow graph changes.

The same idea also describes implementation. Patch mode today is roughly:

1. "Write" loop `N` times with an implementation prompt.
2. "Human" loop `N` times for PR review and merge.

A common stricter implementation workflow might instead be:

1. "Write" loop `N` times with an implementation prompt.
2. "Review and update" loop `N` times with a code-review prompt.
3. "Review and update" loop `N` times with a security-review prompt.
4. "Human" loop `N` times for final review and merge.

An example of a YOLO workflow would be:

1. "Write" loop 1 time with an intent-creation prompt.
2. "Review and update" loop `N` times with an intent-refinement prompt.
3. "Write" loop 1 time with a draft-spec prompt.
4. "Review and update" loop `N` times with a spec-review prompt.
5. "Write" loop `N` times with an implementation prompt.
6. "Review and update" loop `N` times with a code-review prompt.
7. "Review and update" loop `N` times with a security-review prompt.
8. "Human" loop `N` times for final review and merge.

Or

1. "Write" loop 1 time with an intent-creation prompt.
2. "Write" loop 1 time with a draft-spec prompt.
3. "Write" loop `N` times with an implementation prompt.
4. "Human" loop `N` times for final review and merge.

This is the v2 architecture: "plan", "implement", "review", and "yolo" are not hardcoded modes in Jarvis source. They are named workflow presets composed from the smaller behavior vocabulary Jarvis exposes. Prompts and model choices become step inputs, not hardcoded mode internals. The host/runner owns sequencing, bounded repeats, state handoff, quota fallback, telemetry, and human checkpoints. The concrete workflow/step/config model, the execution model (output contract, runs, state, the human loop), concurrency, and git mechanics are worked out in [`v2-architecture.md`](v2-architecture.md).

## Architectural constraints

Constraints v2's architecture must satisfy. Some are forward-looking (server, UI); some bind from day one (PR size). None get their own work-stream intents yet — the architecture design intent must check itself against all of them.

- **Subspec ≈ PR, capped.** Every subspec compiles to a PR under 1000 lines, with ~600 as the sweet spot. v2's planner has to decompose work into chunks that hit that ceiling. The cap should be configurable, not hardcoded — different projects may want different ceilings.
- **Structured logging.** First-class, structured, queryable — not ad-hoc stdout. The runtime should produce a log stream that something else can consume.
- **A long-running server.** A host process that hosts orchestrations rather than each run living in its own terminal window. v2's core should be embeddable, not assume a one-shot CLI lifecycle.
- **An orchestration UI.** One interface to launch, monitor, and steer many concurrent jarvis runs. Implies a programmatic surface (API/IPC) over each operation, not just CLI flags.
- **Cost-efficient.** Workflows can chain many agent calls. Optimize prompts, agent choice, and orchestration to hit the target without wasted agent use. Anything that can be deterministic should be.
- **Memory-efficient.** Concurrent agents plus a local model must not bog down the machine. Drives the adaptive admission and on-demand local model in `v2-architecture.md`.
- **Configurable.** If something shouldn't be hardcoded, it belongs in config (the data layer). Don't ignore that instinct.
- **Composable.** Different projects need different postures — sensitive projects want more human/review steps, others run YOLO — and even sensitive projects don't need a full plan/review cycle for every small change.
- **Extendible.** Changes should be easy to make and easy to review. Cheaper, and it builds trust in them.
- **Reliable.** Unit-test business logic; measure coverage and block on drops; integration-test workflows. Evals (on-demand only, with heuristics for when to run) catch outcome drift — deferred for now.

## Coexistence, not replacement

v1 is not going away. Once v2 ships, v1 stays installed and runnable forever as the "reliable jarvis" alongside the new one:

- `jarvis1` — the stable v1 engine. Same code behavior as today's `jarvis`. "Stable" means the engine, not the prompts: it reads the shared, evolving `prompts/` like v2 does.
- `jarvis` — v2. The new orchestration layer. Built incrementally; users opt in by running it.

The rename happens almost immediately after the v1/v2 repo split so the two binaries coexist for the entire v2 build, not just after it lands.

Install is intentionally not fancy — symlinks on two machines (personal + work). No packaging strategy is needed.

## Rollout strategy

1. **Split repo into `v1/` and `v2/`.** Move current code, tests, and specs into `v1/`. Create `v2/` as a sibling. Root keeps only repo-wide config. *(First intent — see `v2.txt`.)*
2. **Rename binary `jarvis` → `jarvis1`, reserve `jarvis` for v2.** *(See `v2-rename-binary.txt`.)*
3. **Catalog v1 behaviors** — one high-level doc covering every user-facing behavior, produced by reading source exhaustively, then iterated on with review. *(See `v2-catalog.txt`.)*
   While v1 remains active during rollout, parity-relevant v1 behavior changes should update `v2/docs/v1-behaviors.md` in the same change window to keep v2 planning grounded in current behavior.
4. **Design v2 architecture** — composable operations + host. Must satisfy the constraints above. The decided model is captured in [`v2-architecture.md`](v2-architecture.md).
5. **Build v2 incrementally**, behavior-by-behavior. `jarvis` (v2) becomes usable as features land; `jarvis1` remains the daily-driver until v2 reaches parity.
6. **No deletion of v1.** Both commands stay installed indefinitely.
