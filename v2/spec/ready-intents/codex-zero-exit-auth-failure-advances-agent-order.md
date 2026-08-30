---
name: codex-zero-exit-auth-failure-advances-agent-order
---

# A zero-exit codex credential-auth failure classifies as quota/authFailure so the agent order advances

Unsplit rationale: the whole fix lands in the zero-exit branch of the shared invocation settle classifier (`shared/invocation/agents.ts`); every downstream consumer of `{kind: "quota", authFailure: true}` already advances the agent order unchanged, so there is no second module-boundary surface to split against.

## Primary implementation surface

- execution-loop — `shared/invocation/agents.ts` zero-exit settle classification

## Problem

A codex invocation that does nothing but fail credential auth exits 0, so `settleZeroExit` settles `{kind: "ok"}`. The write loop sees a "successful" iteration with no file changes and no completion token → `invocation_failure` (`resumable: false`), and the pipeline stage settles `invocation_error` / `nextAction: stop`. The harness already carries patterns matching the output verbatim (`codexCredentialAuthPatterns` includes `/\bplease log out and sign in\b/i`), but `isCredentialAuthSignal` hard-returns `false` on `exitCode === 0` and is only reachable from `settleNonZeroExit`. The zero-exit path tests only `quotaPatternsFor(classifier)` (usage/rate-limit phrases), which never match auth text.

Observed 2026-08-28 (#3027): pipeline `af881ac0` on `cbrenner04/chess-mvp-yolo`, run `045b445a`, lane `game-model-check-exposure` — iteration 2 spawned a fresh `codex exec` after the ChatGPT refresh token expired, produced ~26s of `401 Unauthorized` / `Failed to refresh token: … please log out and sign in again` with zero tool activity, and still exited 0. cursor was next in the order and healthy; the lane died instead of advancing.

## Prerequisites

- A non-zero-exit codex invocation whose diagnostics match the credential-auth patterns settles `{kind: "quota", authFailure: true}`.
- A `quota` result with `authFailure: true` advances the outer agent order to the next configured agent instead of failing the run terminally.

## Decisions

- The zero-exit path consults `codexCredentialAuthPatterns` and, on a match with no productive work, settles `{kind: "quota", authFailure: true}` — rules out leaving the zero-exit path with no auth defense.
- The zero-exit auth match reads the invocation's stderr only, not the combined stderr+stdout the zero-exit quota check uses — agent stdout can legitimately quote "log out and sign in"; rules out a false positive on a healthy run that merely narrates the phrase.
- Zero-exit quota-pattern behavior is otherwise unchanged; a productive zero-exit invocation still settles `ok` — rules out reclassifying healthy runs.
- `v1/src/agents/spawn.ts` keeps its own duplicate classifier and is out of scope — v1 is maintenance-only; rules out a speculative parallel edit.

## Acceptance criteria

- [ ] A zero-exit codex invocation whose stderr matches a credential-auth pattern with no productive work settles `{kind: "quota", authFailure: true}` rather than `{kind: "ok"}`.
- [ ] A zero-exit codex invocation that only quotes an auth phrase on stdout while doing real work still settles `{kind: "ok"}`.
- [ ] A zero-exit auth-classified result advances to the next configured agent instead of settling the run `invocation_error`.
- [ ] `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, and `bun run test:integration:v2` pass (shared surface).

## Documentation updates

- `v2/docs/v1-behaviors.md` — the zero-exit codex path now treats credential-auth stderr as an agent-advancing signal.
- `v1/docs/quota-signals.md` — same, in the codex signal table.
