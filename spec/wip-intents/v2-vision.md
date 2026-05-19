# Jarvis v2 — Vision

This is a long-lived reference doc, not a plan intent. It captures the *why* and the open questions for the v2 rewrite. Individual v2 work items live as their own intents and reference this doc.

## Repo layout (target)

Top-level `v1/` and `v2/` directories. Only repo-root config (CI, root README, root `.gitignore`, etc.) stays at the root. v1 and v2 each own their own `src/`, `test/`, `spec/`, and tooling config. v2 planning artifacts (including this doc and the wip intents) live under `v2/spec/` once the v1/v2 split lands.

## Why rewrite

Jarvis v1 was built rapidly without a plan. It works, but the codebase is out of control: PRs are large even for small changes, and the abstractions don't hold up as more capabilities get added. Rather than refactor in place, the plan is to rebuild — keeping v1 running the whole time — using v1's behavior as the spec.

## Core premise

Treat English as code, where a combination of words produces a behavior. To make that behavior predictable, compose the words carefully and repeatably. Jarvis is that idea, applied.

v2 takes the same idea one level up. Instead of just composing prompts, it composes operations (plan, implement, review, and so on) into reliable orchestrations.

## Guiding principles

- **Behavior is the source of truth.** v1's *implementation* is mostly disposable; its *behaviors and user workflows* are what v2 must preserve (minus things we discover are unused).
- **Documented in code.** Inline documentation is a first-class output, not an afterthought. Separate higher-level docs keep the big picture coherent.
- **Composable over modal.** "mode" (plan / patch / review / yolo) is probably the wrong primitive — see open questions below.
- **No tech-stack churn.** bun + biome + typescript stay.
- **Drop the dead weight.** Anything v1 has that isn't actually used should not be carried forward.

## Naming clean-up

- `run` / "patch mode" → `implement`. Drop both "run" and "patch" as user-facing terms.

## Open questions (prompts)

If English is code, prompts deserve the same treatment as code: versioned, reusable, reviewable, not buried inline. Worth resolving as part of the v2 architecture design:

- Should prompts live in a shared top-level directory (e.g. `prompts/`) that both v1 and v2 read from, rather than being inlined in each codebase?
- If shared, does v1 actually pick up prompt improvements over time, or does v1 pin a frozen snapshot so its behavior stays stable?
- If v2-only, when does extraction happen — as part of v2 day one, or later?

## Open questions (composability)

The current "mode" model breaks down under the next round of features:

- **`review`** is the next capability to add — but review wants to run *throughout* a plan or implement flow, not stand alone alongside them. That makes it not-a-mode in the same sense plan/implement are.
- **`yolo`** is plan + implement + review composed. If yolo is a mode, then modes-compose-modes, which means "mode" is really just "named pipeline of operations."
- The right primitive is probably something like **composable operations** (plan, implement, review, …) plus a **host/runner** that orchestrates them. Modes become preset compositions, not a distinct kind of thing.

## Architectural constraints

Constraints v2's architecture must satisfy. Some are forward-looking (server, UI); some bind from day one (PR size). None get their own work-stream intents yet — the architecture design intent must check itself against all of them.

- **Subspec ≈ PR, capped.** Every subspec compiles to a PR under 1000 lines, with ~600 as the sweet spot. v2's planner has to decompose work into chunks that hit that ceiling. The cap should be configurable, not hardcoded — different projects may want different ceilings.
- **Structured logging.** First-class, structured, queryable — not ad-hoc stdout. The runtime should produce a log stream that something else can consume.
- **A long-running server.** A host process that hosts orchestrations rather than each run living in its own terminal window. v2's core should be embeddable, not assume a one-shot CLI lifecycle.
- **An orchestration UI.** One interface to launch, monitor, and steer many concurrent jarvis runs. Implies a programmatic surface (API/IPC) over each operation, not just CLI flags.

## Coexistence, not replacement

v1 is not going away. Once v2 ships, v1 stays installed and runnable forever as the "reliable jarvis" alongside the new one:

- `jarvis1` — the stable, frozen v1 command. Same behavior as today's `jarvis`.
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
