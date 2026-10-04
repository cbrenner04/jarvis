# AGENTS.md

Conventions for working in this repo — humans and coding agents alike. **BE TERSE** everywhere (specs, intents, commits, comments, PRs): verbosity costs review effort and money. **Do not hard-wrap authored markdown** (specs, ready-intents, seeds, docs, PR bodies) — one physical line per paragraph and list item.

## What this repo is

Jarvis is a minimal coding-agent harness driving an underlying agent CLI (`claude`, `codex`, `cursor`, …). One engine: **`jarvis` (`v2/src/cli.ts`)**, a daemon-backed workflow runner: `init`, `daemon`, `run` (start/list/log/pause/resume/kill/dismiss/undismiss/wait), `run workflow intent|plan|implement`, `pipeline` (start/list/wait/approve/reject/resume/recover/dismiss/undismiss), `tui`, `cleanup`. Docs: [v2/docs/](v2/docs/), start at [v2/docs/onboarding.md](v2/docs/onboarding.md).

Work here is work on the harness itself. Layout:

- root — shared glue, config, public docs, `scripts/` and `data/` (global `prices.json`), `prompts/` (committed per-workflow prompt templates), `reports/` (session reports), `test/` and `scripts/*.test.ts` (root-tooling tests, run in the `test:v2` / `test:integration:v2` slices)
- `v2/` — the implementation (src, spec, docs), with tests co-located next to the source files they cover; shared runtime modules live under `v2/src/shared/`
- `v1/` — **frozen.** The retired first engine, kept on disk for reference only: not compiled, tested, linted, linked, or shipped (`bin/jarvis1` is gone). Never edit it, never route work to it, never cite it as a live source. See [v1/README.md](v1/README.md).

## Core decisions

- **Stack**: TypeScript on Bun, strict typing (`strict`, `noUncheckedIndexedAccess`).
- **Distribution**: personal use — clone and symlink the binary onto `PATH`. No npm publish. **Single operator**: the repo owner is the only user — "every user" means one person, so don't design for multi-user config, onboarding, or required-by-default setup.
- **Config**: `~/.jarvis/config.json` holds the project registry and the `agents` order (hand-edited; `jarvis init` seeds it when absent); role→model rungs live in committed `config/machines/<profile>.json`. See [v2/docs/install-and-config.md](v2/docs/install-and-config.md).
- **Agent fallback order**: `claude → codex → cursor`, configurable; advances on quota only. See [v2/docs/agent-model-config.md](v2/docs/agent-model-config.md).
- **Spec format** (target repos): Markdown with `- [ ]` task lists. Complete = zero unchecked items.
- **Git operations**: `v2/src/shared/git.ts` is the canonical Git boundary for Jarvis-owned code (v2, root scripts). New code calls its typed exports rather than constructing `git` argv; root `scripts/**` already comply (`scripts/ready.ts` resolves its git dir through `gitDir` with an injected runner) and must never spawn `git` directly. `scripts/guard-git-spawn-bypass.ts` (in `bun run check`) forbids `runAsync("git"|"gh", …)` in `v2/src` production modules except allowlisted owners `v2/src/shared/git.ts`, `v2/src/shared/executable-tree.ts`, and `v2/src/execution/github-operations.ts`; escape only with `// guard-git-spawn-bypass: <reason>` on the spawn line or the line above. See [v2/docs/v2-architecture.md § Git operation ownership](v2/docs/v2-architecture.md#git-operation-ownership).
- **GitHub PR operations**: `v2/src/execution/github-operations.ts` is the single owner of `gh` for Jarvis-owned code. Callers use its typed exports (`listPrs`, `viewPr`, `viewPrState`, `createPr`, `markPrReady`, `undoPrReady`, `closePr`, …) and inject the runner; never construct `gh` argv inline (the spawn-bypass guard enforces this in `v2/src` production code). See [v2/docs/v2-architecture.md § GitHub operation ownership](v2/docs/v2-architecture.md#github-operation-ownership).
- **Quota detection**: per-agent stderr/exit-code heuristics — [v2/docs/quota-signals.md](v2/docs/quota-signals.md).
- **Operator docs**: [v2/docs/operator-runbook.md](v2/docs/operator-runbook.md) (command mechanics, recovery); [v2/docs/operator-practices.md](v2/docs/operator-practices.md) (session discipline, merging, cost reporting, sandbox blindness).

Each iteration the agent is told to inspect the target repo for guidance, read the spec, follow the inline-injected write-step rules, and complete the single most important unchecked task.

## Specs in this repo

Specs live under `v2/spec/` (the jarvis project `plan.targetDir`). Long-lived reference docs live in `v2/docs/`. Multi-file specs go in `<targetDir>/<UTC-timestamp>-<name>/` with an `index.md`. The index is the routing file: a checklist of subspec pointers, each checked when done. Each subspec is **atomic, independently testable**, and carries a **Documentation updates** section (docs are part of the work). Create with `jarvis run workflow intent|plan`. On completion Jarvis archives the spec dir to `<targetDir>/completed/` — archive presence is not proof the work merged; verify the feature on `main` before trusting it. Full conventions: [v2/docs/spec-guidance.md](v2/docs/spec-guidance.md). Specs changing existing functionality update the behavior catalog [v2/docs/v1-behaviors.md](v2/docs/v1-behaviors.md); doc placement follows [v2/docs/documentation-standard.md](v2/docs/documentation-standard.md).

## Working rules for agents

- Do work on a git worktree, not the primary checkout.
- Temp/scratch/working files go in repo-local `.scratch/` (gitignored) — not system `/tmp` or scattered tmp dirs.
- A spec must exist before any change. None yet? Create one first ([spec-guidance.md](v2/docs/spec-guidance.md)), merge it to `main` via PR, *then* start a separate implementation run. Specs already on disk get run through `jarvis`, not implemented by hand.
- Run `bun run typecheck` (unscoped) before ticking the acceptance criteria they cover, plus the test script(s) matching the surface(s) touched since the branch/merge-base (`git diff <merge-base>...`), surfaces additive/unioned: `v2/**`, `v2/src/shared/**`, and root `test/**` → `test:v2` + `test:integration:v2` (matches `scripts/ci-test-scope.ts` for those paths); root `scripts/**/*.test.ts` files run in those slices but any `scripts/` diff classifies to `full` in CI and ready — run `bun run test` when script paths changed; diffs touching only docs (`v2/docs/**`, root `*.md`, `LICENSE`), specs, `ready-intents/`, `reports/`, or the frozen `v1/**` → no tests; other root tooling or surface undetermined → full `bun run test`. Do not run `bun run ready` — Jarvis runs that harness gate automatically when the spec completes and flips the draft PR to ready.
- While iterating, run only the test files you changed or that cover your change (`bun test <file>`). Run each scoped script above **once**, when the work is done, before ticking — not as a loop: `test:v2` takes minutes under load, and repeated runs exhaust the iteration budget (observed 2026-10-01: 27 `test:v2` runs in one 45-minute `iteration_timeout`).
- `test:integration:v2` holds the `*.sandbox-unrunnable.test.ts` files (real sockets and processes). They cannot pass inside an agent sandbox, and the harness runs them outside it at the ready gate: agents do not run them, and a criterion naming them alongside checks you can run is ticked once those checks pass. A socket `EPERM`/bind failure in `test:v2` is a misclassified file — note it, do not loop on it.
- Spec acceptance criteria that name the test gate name the scoped script(s) above for the touched surfaces (`bun run test:v2`, not bare `bun run test`); the aggregate takes minutes per iteration and times out correct work.
- If a scoped test run fails in-sandbox, re-run it once serially before treating the failure as real or grounding a blocker: `JARVIS_TEST_CONCURRENCY=1 bun run test:v2`, or `bun test <file>`. Only a serially-reproducing failure is real. Reserve `bun run test:confirm:live` for hand confirmation outside the sandbox (operator recovery).
- Tests reaching machine/user-config resolution must inject an explicit config fixture/path and mocked profile; never read the ambient machine config.
- When a guard sits inside a `setTimeout` or `setInterval` callback, extract it into a pure exported predicate and test both truth directions directly without a real-timer wait.
- **Open PRs as draft; flip to ready only when done.** A non-draft PR reads as mergeable — another operator or process may review and land it as-is, dropping later pushes. Push every commit first, then `gh pr ready`. See [operator-practices.md § Merging](v2/docs/operator-practices.md#merging).
- Keep changes within the task's scope — no speculative refactors, no unauthorized harness changes.
- Inside a Jarvis implement run, the harness injects its own mechanics (the active subspec, ticking `## Acceptance criteria`, index and commit ownership, `## Blocker`, the terminal token) through `prompts/implement/rules.md` and the step rules; this file does not restate them.
- **Concise updates.** When reporting back, report only what's needed: the command run and the landed result, plus a concise session summary after each landed intent. No running commentary. See [v2/docs/operator-practices.md#operator-feedback-cadence](v2/docs/operator-practices.md#operator-feedback-cadence).
- **No planning labels in code.** Phase/milestone/slice names are sequencing artifacts — never bake them into identifiers, filenames, or public API. A spec saying "Phase 1 state store" names *the state store*; call it that.
- **Do not poll for completion.** Backgrounded pipelines and runs push operator-actionable boundaries through the daemon's `notificationSinkCommand` sweep when configured ([v2/docs/operator-runbook.md § Operator notifications](v2/docs/operator-runbook.md#operator-notifications)). Use `jarvis pipeline wait` / `jarvis run wait` only when foreground-blocking; reserve `run list` / `lsof` loops for missed-notification diagnosis.

## PR attribution

Jarvis stamps every commit with a `Jarvis-Agent: <label>` trailer and renders an attribution footer onto draft-PR bodies from them — automatic, not requested of the agent. Mechanics (trailers, footer format, step counts): [v2/docs/write-behavior.md § Commit trailers and PR attribution](v2/docs/write-behavior.md#commit-trailers-and-pr-attribution).

## Harness friction?

If you hit friction using Jarvis as a coding agent in another repo — a missing feature, a workflow gap, a confusing error — [surface it here](https://github.com/cbrenner04/jarvis/issues/new/choose). This is the official channel for harness suggestions.
