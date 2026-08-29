---
name: codex-invocation-tolerates-git-disabled-workspaces
---

# Codex invocation tolerates git-disabled workspaces and advances on refusal

## Prerequisites

## Module-boundary surface

- Execution loop: shared codex invocation adapter and exit classifier in `shared/invocation/agents.ts`.

## Problem

v2 spawns `codex exec` without `--skip-git-repo-check`, so codex ≥0.150 refuses git-disabled staging dirs under `~/.jarvis/intent-work/` and exits 1; the refusal classifies as non-advancing `error`, killing intent/plan stages on codex-first orders instead of trying sibling agents (#3106).

## Decision ledger

- Add `--skip-git-repo-check` unconditionally to shared codex argv; rules out per-callsite conditional plumbing or `trust_level` overrides (verified ineffective 2026-08-29).
- Classify the trusted-directory refusal stderr as `{kind: "quota", authFailure: true}` via the credential-auth precedent; rules out a false terminal on codex binaries where the flag regresses.
- Extend `codexQuotaPatterns` with guarded 429 / `Too Many Requests` transport lines mirroring claude/opencode; rules out misclassifying transport throttling as a non-advancing hard error.
- Out of scope: generic advance-on-`error`/`model_config` policy, per-project agent orders, v1's local codex adapter.

## Acceptance criteria

- [ ] `shared/invocation/agents.test.ts` proves the codex adapter argv includes `--skip-git-repo-check`; it fails against the pre-fix argv.
- [ ] `shared/invocation/agents.test.ts` proves exit 1 with stderr `Not inside a trusted directory and --skip-git-repo-check was not specified.` settles `{kind: "quota", authFailure: true}`; it fails against current classification.
- [ ] An agent-order test proves the trusted-directory refusal advances to the next configured binding rather than terminating the chain; it fails against current classification.
- [ ] `shared/invocation/agents.test.ts` proves exit 1 with a guarded 429/`Too Many Requests` line settles `{kind: "quota"}` for codex; it fails against current patterns.
- [ ] `bun run typecheck` and `test:v1` + `test:v2` + `test:integration:v2` pass (shared surface).

## Documentation updates

- `v1/docs/quota-signals.md` — codex signal table gains trusted-directory refusal and 429 rows (v2 shared classifier; note v1 parity status).
- `v2/docs/v1-behaviors.md` — v2 codex spawns with `--skip-git-repo-check`; v1 does not.
- `v2/docs/operator-runbook.md` — remove or adjust any codex git-disabled workspace caveat this obsoletes.
