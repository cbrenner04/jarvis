# AGENTS.md

Conventions for working in this repo — humans and coding agents alike. **BE TERSE** everywhere (specs, intents, commits, comments, PRs): verbosity costs review effort and money. **Do not hard-wrap authored markdown** (specs, ready-intents, seeds, docs, PR bodies) — one physical line per paragraph and list item.

## What this repo is

Jarvis is a minimal coding-agent harness driving an underlying agent CLI (`claude`, `codex`, `cursor`, …). One engine: **`jarvis` (`v2/src/cli.ts`)**, a daemon-backed workflow runner: `init`, `daemon`, `config`, `run` (start/list/log/pause/resume/kill/dismiss/undismiss/wait), `run workflow intent|plan|implement`, `pipeline` (start/list/wait/approve/reject/resume/recover/dismiss/undismiss), `tui`, `cleanup`. Docs: [v2/docs/](v2/docs/), start at [v2/docs/onboarding.md](v2/docs/onboarding.md).

Work here is work on the harness itself. Layout:

- root — shared glue, config, public docs, `scripts/` and `data/` (global `prices.json`), `prompts/` (committed per-workflow prompt templates), `reports/` (session reports), `test/` and `scripts/*.test.ts` (root-tooling tests, run by the `test:shared` scripts)
- `shared/` — runtime code consumed by `v2`; `shared/**` must not import from `v2/**`
- `v2/` — the implementation (src, spec, docs), with tests co-located next to the source files they cover
- `v1/` — **frozen.** The retired first engine, kept on disk for reference only: not compiled, tested, linted, linked, or shipped (`bin/jarvis1` is gone). Never edit it, never route work to it, never cite it as a live source. See [v1/README.md](v1/README.md).

## Core decisions

- **Stack**: TypeScript on Bun, strict typing (`strict`, `noUncheckedIndexedAccess`).
- **Distribution**: personal use — clone and symlink the binary onto `PATH`. No npm publish. **Single operator**: the repo owner is the only user — "every user" means one person, so don't design for multi-user config, onboarding, or required-by-default setup.
- **Config**: `~/.jarvis/config.json` holds the project registry and the `agents` order (edit via `jarvis config set-agents`); role→model rungs live in committed `config/machines/<profile>.json`. See [v2/docs/install-and-config.md](v2/docs/install-and-config.md).
- **Agent fallback order**: `claude → codex → cursor`, configurable; advances on quota only. See [v2/docs/agent-model-config.md](v2/docs/agent-model-config.md).
- **Spec format** (target repos): Markdown with `- [ ]` task lists. Complete = zero unchecked items.
- **Quota detection**: per-agent stderr/exit-code heuristics — [v2/docs/quota-signals.md](v2/docs/quota-signals.md).
- **Operator docs**: [v2/docs/operator-runbook.md](v2/docs/operator-runbook.md) (command mechanics, recovery); [v2/docs/operator-practices.md](v2/docs/operator-practices.md) (session discipline, merging, cost reporting, sandbox blindness).

Each iteration the agent is told to inspect the target repo for guidance, read the spec, follow the inline-injected write-step rules, and complete the single most important unchecked task.

## Specs in this repo

Specs live under `v2/spec/` (the jarvis project `plan.targetDir`). Long-lived reference docs live in `v2/docs/`. Multi-file specs go in `<targetDir>/<UTC-timestamp>-<name>/` with an `index.md`. The index is the routing file: a checklist of subspec pointers, each checked when done. Each subspec is **atomic, independently testable**, and carries a **Documentation updates** section (docs are part of the work). Create with `jarvis run workflow intent|plan`. On completion Jarvis archives the spec dir to `<targetDir>/completed/` — archive presence is not proof the work merged; verify the feature on `main` before trusting it. Full conventions: [v2/docs/spec-guidance.md](v2/docs/spec-guidance.md).

## Working rules for agents

- Do work on a git worktree, not the primary checkout.
- Temp/scratch/working files go in repo-local `.scratch/` (gitignored) — not system `/tmp` or scattered tmp dirs.
- A spec must exist before any change. None yet? Create one first ([spec-guidance.md](v2/docs/spec-guidance.md)), merge it to `main` via PR, *then* start a separate implementation run. Specs already on disk get run through `jarvis`, not implemented by hand.
- Read `index.md` to pick the next unchecked subspec, then read that subspec before editing.
- Run `bun run typecheck` (unscoped) before ticking the acceptance criteria they cover, plus the test script(s) matching the surface(s) touched since the branch/merge-base (`git diff <merge-base>...`), same rule as `scripts/ci-test-scope.ts` (surfaces are additive/unioned): `v2/**` → `test:v2` + `test:integration:v2`; `shared/**` → that pair plus `test:shared` + `test:integration:shared`; root `test/**` → the `test:shared` pair; diffs touching only docs (`v2/docs/**`, root `*.md`, `LICENSE`), specs, `ready-intents/`, `reports/`, or the frozen `v1/**` → no tests; root tooling touched, or surface undetermined → full `bun run test`. Do not run `bun run ready` — Jarvis runs that harness gate automatically when the spec completes and flips the draft PR to ready.
- Tick `- [ ]` items only in the subspec's `## Acceptance criteria` section, only once satisfied, never speculatively. Other checklist sections are informational; Jarvis ignores them.
- **Do not** edit `index.md` or run `git commit` — Jarvis owns the index checkbox and all commits (`git add -A` would absorb manual ones unexpectedly).
- If a scoped test run fails, re-run once serially as `bun test` (without `--parallel`, no path/filter args) before treating the failure as real or grounding a blocker; only a serially-reproducing failure is real.
- Tests reaching machine/user-config resolution must inject an explicit config fixture/path and mocked profile; never read the ambient machine config.
- When a guard sits inside a `setTimeout` or `setInterval` callback, extract it into a pure exported predicate and test both truth directions directly without a real-timer wait.
- Blocked or ambiguous? Append a `## Blocker` to the subspec and stop, rather than guess.
- Keep changes minimal and within the active subspec's scope — no speculative refactors, no unauthorized harness changes.
- **Concise updates.** When reporting back, report only what's needed: the command run and the landed result, plus a concise session summary after each landed intent. No running commentary. See [v2/docs/operator-practices.md#operator-feedback-cadence](v2/docs/operator-practices.md#operator-feedback-cadence).
- **No planning labels in code.** Phase/milestone/slice names are sequencing artifacts — never bake them into identifiers, filenames, or public API. A spec saying "Phase 1 state store" names *the state store*; call it that.
- **Do not poll for completion.** Backgrounded pipelines and runs push operator-actionable boundaries through the daemon's `notificationSinkCommand` sweep when configured ([v2/docs/operator-runbook.md § Operator notifications](v2/docs/operator-runbook.md#operator-notifications)). Use `jarvis pipeline wait` / `jarvis run wait` only when foreground-blocking; reserve `run list` / `lsof` loops for missed-notification diagnosis.

## PR attribution

Jarvis stamps every commit with a `Jarvis-Agent: <label>` trailer and renders an attribution footer onto draft-PR bodies from them — automatic, not requested of the agent. Mechanics (trailers, footer format, step counts): [v2/docs/write-behavior.md § Commit trailers and PR attribution](v2/docs/write-behavior.md#commit-trailers-and-pr-attribution).

## Harness friction?

If you hit friction using Jarvis as a coding agent in another repo — a missing feature, a workflow gap, a confusing error — [surface it here](https://github.com/cbrenner04/jarvis/issues/new/choose). This is the official channel for harness suggestions.
