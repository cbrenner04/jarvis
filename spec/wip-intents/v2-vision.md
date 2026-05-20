# Jarvis v2 — Vision

This is a long-lived reference doc, not a plan intent. It captures the *why* and the open questions for the v2 rewrite. Individual v2 work items live as their own intents and reference this doc.

## Repo layout (target)

One package, multiple source trees. A single root `package.json`, `bun.lock`, and `node_modules` for the whole repo — not Bun workspaces, not a `package.json` per version. v1 and v2 are separate TypeScript projects (separate source trees that cannot import each other), not separate packages. This is the "have your cake and eat it too" shape: one dependency tree and one toolchain, but cleanly separated engines.

```
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
v2/                   # engine v2 (own tsconfig project)
  src/
  test/
  spec/
```

Accepted tradeoff of one lockfile: v1 and v2 share one resolved version of every dependency. Fine because v1 is a stable engine on the same stack, and the shared gate runs v1's tests on every change.

Prompts are a top-level peer, not owned by either engine (see "Core premise" and the prompts intent). They are extracted to `prompts/` as later work, not during the v1/v2 split — the split moves v1's prompts wholesale into `v1/` first.

v2 planning artifacts (this doc and the wip intents) live under `v2/spec/` once the split lands.

## Why rewrite

Jarvis v1 was built rapidly without a plan. It works, but the codebase is out of control: PRs are large even for small changes, and the abstractions don't hold up as more capabilities get added. Rather than refactor in place, the plan is to rebuild — keeping v1 running the whole time — using v1's behavior as the spec.

## Core premise

Jarvis starts from the ethos stated in the [README](../../README.md).

v2 takes the same idea one level up. Instead of just composing prompts, it composes operations (plan, implement, review, and so on) into reliable orchestrations.

## Guiding principles

- **Behavior is the source of truth.** v1's *implementation* is mostly disposable; its *behaviors and user workflows* are what v2 must preserve (minus things we discover are unused).
- **Documented in code.** Inline documentation is a first-class output, not an afterthought. Separate higher-level docs keep the big picture coherent.
- **Composable over modal.** "mode" (plan / patch / review / yolo) is probably the wrong primitive — see open questions below.
- **No tech-stack churn.** bun + biome + typescript stay.
- **Drop the dead weight.** Anything v1 has that isn't actually used should not be carried forward.

## Naming clean-up

- `run` / "patch mode" → `implement`. Drop both "run" and "patch".

## Prompts as first-class artifacts

If English is code, prompts deserve the same treatment as code: versioned, reusable, reviewable, not buried inline — arguably the most important pieces in the repo. Decided so far:

- Prompts live in a **shared top-level `prompts/`** that both engines read from, abstracted out of v1 and v2.
- v1 reads those **shared, evolving** prompts. "Reliable jarvis1" means a stable *engine*, not frozen prompt text — prompt improvements reach v1 too, and there is one source of truth rather than duplicated copies.
- Extraction is **deferred**: the v1/v2 split moves v1's prompts wholesale into `v1/`; hoisting them to `prompts/` is later work.

Still to design (owned by `v2-prompts.txt`): the exact `prompts/` layout, the prompt artifact taxonomy, the rendering/placeholder contract, and the review/testing standard. Because v1 shares evolving prompts, rendered-prompt snapshot or behavior tests matter — a prompt edit can shift `jarvis1` output and that change should be visible and reviewed.

## Open questions (composability)

The current "mode" model breaks down under the next round of features:

- `**review`** is the next capability to add — but review wants to run *throughout* a plan or implement flow, not stand alone alongside them. That makes it not-a-mode in the same sense plan/implement are.
- `**yolo*`* is plan + implement + review composed. If yolo is a mode, then modes-compose-modes, which means "mode" is really just "named pipeline of operations."
- The right primitive is probably something like **composable operations** (plan, implement, review, …) plus a **host/runner** that orchestrates them. Modes become preset compositions, not a distinct kind of thing.

## Architectural constraints

Constraints v2's architecture must satisfy. Some are forward-looking (server, UI); some bind from day one (PR size). None get their own work-stream intents yet — the architecture design intent must check itself against all of them.

- **Subspec ≈ PR, capped.** Every subspec compiles to a PR under 1000 lines, with ~600 as the sweet spot. v2's planner has to decompose work into chunks that hit that ceiling. The cap should be configurable, not hardcoded — different projects may want different ceilings.
- **Structured logging.** First-class, structured, queryable — not ad-hoc stdout. The runtime should produce a log stream that something else can consume.
- **A long-running server.** A host process that hosts orchestrations rather than each run living in its own terminal window. v2's core should be embeddable, not assume a one-shot CLI lifecycle.
- **An orchestration UI.** One interface to launch, monitor, and steer many concurrent jarvis runs. Implies a programmatic surface (API/IPC) over each operation, not just CLI flags.

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
4. **Design v2 architecture** — composable operations + host. Must satisfy the constraints above. Update this doc with the chosen model once decided.
5. **Build v2 incrementally**, behavior-by-behavior. `jarvis` (v2) becomes usable as features land; `jarvis1` remains the daily-driver until v2 reaches parity.
6. **No deletion of v1.** Both commands stay installed indefinitely.

