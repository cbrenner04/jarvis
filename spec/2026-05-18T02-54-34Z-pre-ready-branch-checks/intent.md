---
name: pre-ready-branch-checks
---
we need to update branch checks. we are often getting PRs moved from draft and yet checks are failing. We should use .github/workflows/ci.yml as source of truth for our checks before marking a PR ready for review. All of those checks should pass. Additionally, lets add some scripts to make that easiest.

    "check": "bun node_modules/@biomejs/biome/bin/biome check .",
    "check:fix": "bun node_modules/@biomejs/biome/bin/biome check --write .",
    "check:fix:unsafe": "bun node_modules/@biomejs/biome/bin/biome check --write --unsafe .",
    "format:check": "bun node_modules/@biomejs/biome/bin/biome format .",
    "format": "bun node_modules/@biomejs/biome/bin/biome format --write .",
    "format:unsafe": "bun node_modules/@biomejs/biome/bin/biome format --write --unsafe .",
    "lint": "bun node_modules/@biomejs/biome/bin/biome lint .",
    "lint:fix": "bun node_modules/@biomejs/biome/bin/biome lint --write .",
    "lint:fix:unsafe": "bun node_modules/@biomejs/biome/bin/biome lint --write --unsafe .",

I am ok with `unsafe` versions being used AFTER `write` versions being used as long as the output is inspected and deemed acceptable. Usually they are.

This may require a `bun install` step. Generally on these .worktrees it has not been run. Alternatively we could symlink files/directories needed from main, but I  would assume that might pose some risk.  

## Interview turn 1

Findings from the repo:

- `.github/workflows/ci.yml` runs exactly four steps after checkout/setup-bun: `bun install --frozen-lockfile`, `bun run typecheck`, `bun run test`, `bun run check`. Those four are the source of truth for "PR is ready for review."
- `package.json` already defines: `check`, `format`, `format:check`, `lint`, `typecheck`, `test`, and a partial `test:full` that runs `format && check && format:check && lint && typecheck && test`. The intent lists several additional Biome scripts (`check:fix`, `check:fix:unsafe`, `format:unsafe`, `lint:fix`, `lint:fix:unsafe`) that are **not** currently in `package.json` — they need to be added.
- Current `test:full` does not run `bun install --frozen-lockfile` first, so it can diverge from CI when lockfile/node_modules drift. It also runs `format` (write) before `format:check`, which is redundant but harmless.

Inferred scope / assumptions for the draft:

1. Add the missing Biome scripts (`check:fix`, `check:fix:unsafe`, `format:unsafe`, `lint:fix`, `lint:fix:unsafe`) to `package.json` exactly as listed in the intent.
2. Add a single composite "pre-ready" script (e.g. `ready` or rework `test:full`) that mirrors CI step-for-step in CI order: `bun install --frozen-lockfile` → `typecheck` → `test` → `check`. This becomes the local gate before marking a PR ready for review.
3. Document the workflow in a CONTRIBUTING-style note or CLAUDE.md addition: run the ready script in the worktree, inspect any `--unsafe` diffs before committing, only then flip the PR out of draft.
4. Worktree bun-install question: prefer running `bun install --frozen-lockfile` inside the worktree (matches CI exactly, no symlink ambiguity). Symlinking `node_modules` from `main` is rejected as the default approach because (a) the lockfile in the worktree branch may differ from main, masking install regressions, and (b) Biome/TS resolution against a foreign tree can hide real failures. If install latency is a concern, that's a separate optimization — out of scope here.
5. Naming: kebab-case slug `pre-ready-branch-checks` captures the goal (gate the draft→ready transition with CI-equivalent local checks).

Risks / open items the drafter should keep in mind:

- If `test:full` is renamed or repurposed, check whether any external tooling, hooks, or docs reference it.
- Order matters: `check` (Biome) is the final CI step, so the ready script should not stop at lint/format if test or typecheck already failed — keep `&&` chaining so the first failure halts the run.
- Be explicit that the `:unsafe` variants are developer convenience for fixups, never part of the automated ready script.

## Interview turn 2

Additional repo findings that the drafter must address (turn 1 missed these concrete callsites):

- `test:full` is referenced only inside `package.json` (line 17). A repo-wide grep for `test:full|bun run check|bun run lint|bun run format` turns up no hooks, no CI usage, no `scripts/` callers. Safe to repurpose or rename without external breakage.
- `README.md:277-289` ("## Development" section) is the canonical script index and must be updated in the same PR:
  - Add the five new Biome scripts (`check:fix`, `check:fix:unsafe`, `format:unsafe`, `lint:fix`, `lint:fix:unsafe`).
  - Replace the `test:full` bullet with the new pre-ready script (whatever name is chosen) and describe it as "mirrors CI: install, typecheck, test, check."
  - The line "Run `bun run check` before marking specs complete" is now wrong — the gate is the full ready script, not just `check`. Update wording.
- `AGENTS.md:51` says: *"Run `bun run typecheck` and `bun test` before ticking the acceptance criteria they cover."* This is per-iteration guidance for the agent loop and is **different** from the human draft→ready gate. The drafter should leave AGENTS.md:51 alone (or only minimally clarify) and add the ready-script guidance as a new bullet/paragraph targeted at the human flipping the PR out of draft — do not conflate the two audiences.
- README.md:285 currently mis-describes `check` as "the full non-writing Biome code-quality check." Biome `check` covers lint + format + import sort but not typecheck/test. The replacement copy should not perpetuate this wording.

Naming recommendation for the composite script: `ready` (short, semantic, doesn't collide with existing scripts). If preserving `test:full` matters for muscle memory, keep `test:full` as an alias that runs `ready`, but the primary name should be `ready`. The drafter should pick one and commit.

Open decision the drafter should make explicitly (not punt to the human):

- Whether the ready script runs `bun install --frozen-lockfile` itself, or whether it documents install as a prerequisite and starts at `typecheck`. Recommendation: include `bun install --frozen-lockfile` as the first step so a fresh worktree is one command away from a CI-equivalent run — this directly addresses the intent's stated worktree pain point. Cost is a few seconds when node_modules is already current; benefit is eliminating the "I forgot to install" failure mode that motivates this spec.

Subspec slicing suggestion (atomic, independently verifiable):

1. `package.json` script additions (new Biome scripts + `ready` script). Verification: `bun run ready` succeeds on a clean worktree.
2. Documentation updates (`README.md` Development section rewrite; optional minimal AGENTS.md note distinguishing the per-iteration gate from the draft→ready gate). Verification: docs render correctly and reference only scripts that exist.

Two subspecs is the right granularity — one subspec would also be defensible since the changes are tightly coupled, but splitting lets the docs land cleanly even if script naming needs a second pass.

## Interview turn 3

Confirmed against `package.json` and `.github/workflows/ci.yml` at HEAD; locking the remaining ambiguities so the drafter does not have to re-derive them:

- Current `package.json` scripts present: `check`, `format` (write), `format:check`, `lint`, `typecheck`, `test`, `test:full`, plus non-relevant `install-opencode-permissions` and `start`. Missing (must be added per intent): `check:fix`, `check:fix:unsafe`, `format:unsafe`, `lint:fix`, `lint:fix:unsafe`.
- Note an asymmetry in the existing names: `format` already means "write" and `format:check` means "read-only", while `check` and `lint` mean "read-only" and the new `:fix` variants will be the writers. Drafter should preserve this existing pattern (do not rename `format` → `format:fix`); just add the five new scripts as listed in the intent verbatim. Call out the asymmetry in the README rewrite so readers are not surprised.
- CI ordering confirmed: install → typecheck → test → check. The `ready` script must follow this exact order. The existing `test:full` chain (`format && check && format:check && lint && typecheck && test`) does **not** mirror CI and additionally mutates files via `format` (write) — wrong shape for a pre-ready gate. Drafter should replace `test:full` with `ready` rather than patch the existing chain.
- Concrete `ready` definition the drafter can adopt verbatim: `bun install --frozen-lockfile && bun run typecheck && bun run test && bun run check`. No separate `lint`/`format:check` invocations needed — `biome check` already covers lint + format + import sort, matching what CI runs.
- `test:full` removal: turn 2 confirmed no external callers. Drafter should delete it outright rather than aliasing — aliases invite drift and the new name is semantically distinct enough that muscle memory is not a meaningful loss for this repo.
- Out of scope (do not let the drafter expand into these): changing CI itself, adding pre-commit/pre-push git hooks, wiring `bun run ready` into any agent loop or skill, optimizing worktree install latency via symlinks or shared caches.
