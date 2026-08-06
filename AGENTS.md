# AGENTS.md

Conventions for working in this repo — humans and coding agents alike. **BE TERSE** everywhere (specs, intents, commits, comments, PRs): verbosity costs review effort and money. **Do not hard-wrap authored markdown** (specs, ready-intents, seeds, docs, PR bodies) — one physical line per paragraph and list item.

## What this repo is

Jarvis is a minimal coding-agent harness driving an underlying agent CLI (`claude`, `codex`, `cursor`, …). Two engines:

- **`jarvis` (v2, `v2/src/cli.ts`) — the primary harness.** Daemon-backed workflow runner: `write`, `daemon`, `config`, `run` (start/list/log/pause/resume/kill/wait), `run workflow intent|plan|implement`, `tui`, `cleanup`. Docs: [v2/docs/](v2/docs/), start at [v2/docs/onboarding.md](v2/docs/onboarding.md).
- **`jarvis1` (v1, `v1/src/cli.ts`) — maintenance-only fallback.** Kept green, no new investment. Docs: [v1/docs/](v1/docs/).

Work here is work on the harness itself. Layout:

- root — shared glue, config, public docs, version-agnostic `scripts/` and `data/` (global `prices.json`)
- `shared/` — version-agnostic runtime code consumed by both `v1` and `v2`; `shared/**` must not import from `v1/**` or `v2/**`
- `v1/` — maintenance-only fallback (src, test, spec, docs)
- `v2/` — primary implementation (src, spec, docs), with tests co-located next to the source files they cover

## Core decisions

- **Stack**: TypeScript on Bun, strict typing (`strict`, `noUncheckedIndexedAccess`).
- **Distribution**: personal use — clone and symlink the binary onto `PATH`. No npm publish. **Single operator**: the repo owner is the only user — "every user" means one person, so don't design for multi-user config, onboarding, or required-by-default setup.
- **Config**: `~/.jarvis/config.json` holds the project registry and the v2 `agents` order (edit via `jarvis config set-agents`); role→model rungs live in committed `config/machines/<profile>.json`. See [v2/docs/install-and-config.md](v2/docs/install-and-config.md); v1 config: [v1/docs/config.md](v1/docs/config.md).
- **Agent fallback order**: `claude → codex → cursor`, configurable; advances on quota only. See [v2/docs/agent-model-config.md](v2/docs/agent-model-config.md).
- **Spec format** (target repos): Markdown with `- [ ]` task lists. Complete = zero unchecked items.
- **Quota detection**: per-agent stderr/exit-code heuristics — [v1/docs/quota-signals.md](v1/docs/quota-signals.md).
- **Operator runbooks**: [v2/docs/operator-runbook.md](v2/docs/operator-runbook.md) (primary); [v1/docs/operator-runbook.md](v1/docs/operator-runbook.md) (session patterns, sandbox blindness, recovery).

Each iteration the agent is told to inspect the target repo for guidance, read the spec, follow the inline-injected write-step rules, and complete the single most important unchecked task.

## Specs in this repo

**Route by target:** new specs default to `v2/spec/` (the jarvis project `plan.targetDir`); `v1/spec/` only for genuine v1 maintenance fixes, authored with explicit `--target-dir v1/spec`.

Long-lived v2 reference docs live in `v2/docs/`. Multi-file specs go in `<targetDir>/<UTC-timestamp>-<name>/` with an `index.md`. The index is the routing file: a checklist of subspec pointers, each checked when done. Each subspec is **atomic, independently testable**, and carries a **Documentation updates** section (docs are part of the work). Create with `jarvis run workflow intent|plan`. Full conventions: [v1/docs/spec-guidance.md](v1/docs/spec-guidance.md).

## Working rules for agents

- Do work on a git worktree, not the primary checkout.
- Temp/scratch/working files go in repo-local `.scratch/` (gitignored) — not system `/tmp` or scattered tmp dirs.
- A spec must exist before any change. None yet? Create one first ([spec-guidance.md](v1/docs/spec-guidance.md)), merge it to `main` via PR, *then* start a separate implementation run. Specs already on disk get run through `jarvis`, not implemented by hand.
- Read `index.md` to pick the next unchecked subspec, then read that subspec before editing.
- Run `bun run typecheck` (unscoped) before ticking the acceptance criteria they cover, plus the test script(s) matching the surface(s) touched since the branch/merge-base (`git diff <merge-base>...`), same rule as `scripts/ci-test-scope.ts` (surfaces are additive/unioned): `v1/**` → `test:v1`; `v2/**` → `test:v2` + `test:integration:v2`; both `v1/**` and `v2/**` touched → `test:v1` + `test:v2` + `test:integration:v2`; `shared/**` → all three; root tooling touched, or surface undetermined → full `bun run test`. Do not run `bun run ready` — Jarvis runs that harness gate automatically when the spec completes and flips the draft PR to ready.
- Tick `- [ ]` items only in the subspec's `## Acceptance criteria` section, only once satisfied, never speculatively. Other checklist sections are informational; Jarvis ignores them.
- **Do not** edit `index.md` or run `git commit` — Jarvis owns the index checkbox and all commits (`git add -A` would absorb manual ones unexpectedly).
- Blocked or ambiguous? Append a `## Blocker` to the subspec and stop, rather than guess.
- Keep changes minimal and within the active subspec's scope — no speculative refactors, no unauthorized harness changes.
- **Concise updates.** When reporting back, report only what's needed: the command run and the landed result, plus a concise session summary after each landed intent. No running commentary. See [v1/docs/operator-runbook.md#operator-feedback-cadence](v1/docs/operator-runbook.md#operator-feedback-cadence).
- **No planning labels in code.** Phase/milestone/slice names are sequencing artifacts — never bake them into identifiers, filenames, or public API. A spec saying "Phase 1 state store" names *the state store*; call it that.
- **Log server is always running** on the operator machine (`jarvis1 log-server` on `127.0.0.1:4310`, started and owned outside agent sessions). **Never** start, stop, restart, or kill port-4310 processes from an agent session — a second instance fights for the port or displaces the operator's long-lived server. `plan`/`run` preflight `log server unreachable` is almost always sandbox blindness; see [operator-runbook.md § Log server](v1/docs/operator-runbook.md#log-server).

## PR attribution

Jarvis stamps every commit with a `Jarvis-Agent: <label>` trailer and renders an attribution footer onto draft-PR bodies from them — automatic, not requested of the agent. Mechanics (footer format, plan-mode meta-commit collapsing): [v1/docs/worktrees-and-commits.md](v1/docs/worktrees-and-commits.md).

## Harness friction?

If you hit friction using Jarvis as a coding agent in another repo — a missing feature, a workflow gap, a confusing error — [surface it here](https://github.com/cbrenner04/jarvis/issues/new/choose). This is the official channel for harness suggestions.
