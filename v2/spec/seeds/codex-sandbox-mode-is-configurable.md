---
name: codex-sandbox-mode-is-configurable
---

# Codex's sandbox mode is configurable so it can run at the harness's ambient trust

## Problem

`runCodexBinding` (`shared/invocation/agents.ts:636-646`) hardcodes `--sandbox workspace-write` and `-c approval_policy="on-request"` on every `codex exec`. Codex is the only adapter held below the harness's own trust level — cursor runs `--force`, claude runs `--permission-mode acceptEdits` — and there is no config surface (global or per-project) to change it.

On a target repo whose test command needs the Xcode/simulator toolchain, `workspace-write` denies both things `xcodebuild test -destination 'platform=iOS Simulator,…'` requires: writes under `~/Library/Developer` (DerivedData/Logs/SourcePackages) and the XPC/mach connection to `CoreSimulatorService`. The `approval_policy="on-request"` escalation is dead under non-interactive `codex exec` — "Run outside of the sandbox" is auto-accepted but returns immediately with no execution. So a codex implement lane writes correct code across iterations, then can never run its own tests and settles blocked. With codex first in the machine agent order, this project class cannot use pipelines at all.

## Evidence (2026-08-28, #3028)

Pipeline `af881ac0` on `cbrenner04/chess-mvp-yolo` (`make test` = `xcodebuild … -destination 'platform=iOS Simulator,…' test`): lane `board-display-settings`, run `fb52cb87` (`codex/gpt-5.6-sol`) wrote all production code + tests across three clean iterations, then died purely on in-sandbox verification being impossible. Every future codex iteration on the project hits the same wall. `codex`'s own `workspace-write` policy has no mach-service knob, so it is not fixable from the target repo.

## Decisions

- Codex's sandbox mode becomes a config-driven value threaded into `runCodexBinding`; `buildArgv` emits `--sandbox <mode>`. Rules out leaving codex the only agent with no trust lever.
- Default is `workspace-write` — unchanged behavior for every existing run and target repo. Rules out a silent trust escalation.
- The lever accepts `danger-full-access`, codex's no-sandbox mode, which brings codex to the ambient trust the harness already extends to cursor (`--force`) and claude (`acceptEdits`). When set, `buildArgv` drops the dead `approval_policy="on-request"` args (auto-denied under `codex exec`); `read-only`/`workspace-write` keep current behavior. Rules out shipping the dead escalation on the unsandboxed path.
- Config home is a single machine-global key (the plan picks the exact location: a top-level key in `~/.jarvis/config.json` or `config/machines/<profile>.json`); the mode is read once and threaded through the v2 write/invocation path into `runCodexBinding`. Rules out per-adapter scatter.
- **Per-project** codex sandbox override is out of scope here — it depends on the per-project config read that #3026 reports non-functional in v2; a machine-global lever unblocks the iOS project class now. Note the per-project follow-up on #3026.
- Scope is the shared codex binding + the v2 threading; v1 keeps the `workspace-write` default (the shared `buildArgv` default preserves it) with no new v1 wiring.

## Acceptance criteria

- [ ] `runCodexBinding`/`buildArgv` emits `--sandbox workspace-write` and the `approval_policy="on-request"` args by default (no config set) — pinned by a test asserting the argv, red if the default changes.
- [ ] With the mode set to `danger-full-access`, `buildArgv` emits `--sandbox danger-full-access` and omits the `-c approval_policy="on-request"` args — pinned by a test.
- [ ] The mode is read from the machine-global config home and threaded to the codex binding on a real v2 write/implement invocation path — pinned by a test that sets the config and asserts the resolved mode reaches the binding.
- [ ] An unset or unrecognized config value resolves to `workspace-write` (fail-safe), pinned by a test.
- [ ] `bun run typecheck` and the touched-surface test scripts pass (`shared/**` touched → `test:v1` + `test:v2` + `test:integration:v2`).

## Documentation updates

- `v2/docs/agent-model-config.md` — document the codex sandbox lever, its default, the `danger-full-access` ambient-trust rationale (parity with cursor `--force` / claude `acceptEdits`), and that per-project override is gated on #3026.
- `v2/docs/v1-behaviors.md` — record that the codex adapter sandbox mode is now config-driven with a `workspace-write` default, so v1's codex invocation is unchanged.
