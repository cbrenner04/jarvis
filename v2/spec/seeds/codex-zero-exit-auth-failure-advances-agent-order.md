---
name: codex-zero-exit-auth-failure-advances-agent-order
---

# A zero-exit codex credential-auth failure classifies as quota/authFailure so the agent order advances

## Problem

A codex invocation that did nothing but fail auth settles `kind: "ok"`, so the run fails terminally instead of advancing the outer agent order — even though the harness already has credential-auth patterns matching the output verbatim.

`isCredentialAuthSignal` (`shared/invocation/agents.ts:1034`) hard-returns `false` on `exitCode === 0` and is only called from `settleNonZeroExit` (`agents.ts:315`). The zero-exit path `settleZeroExit` (`agents.ts:295`) tests only `codexQuotaPatterns` (usage/rate-limit phrases), which do not match auth text. So a zero-exit auth failure settles `ok`, the write loop sees a "successful" iteration with no file changes and no completion token → `invocation_failure` (`resumable: false`); the pipeline stage settles `invocation_error` / `nextAction: stop`. `codexCredentialAuthPatterns` (`agents.ts:990`) includes `/\bplease log out and sign in\b/i`, which matches the stderr exactly — had it been consulted, the result would be `{kind: "quota", authFailure: true}`, which advances to the next agent.

## Evidence (2026-08-28, #3027)

Pipeline `af881ac0` on `cbrenner04/chess-mvp-yolo`, run `045b445a`, lane `game-model-check-exposure`: iteration 2 spawned a fresh `codex exec` after the ChatGPT refresh token expired; ~26s of wall-to-wall `401 Unauthorized` / `Failed to refresh token: … please log out and sign in again`, zero tool activity, and codex still exited 0. cursor was next in the order and healthy, but the run/lane died instead of advancing.

## Decisions

- The zero-exit path consults `codexCredentialAuthPatterns` and, on a match with no productive work, classifies `{kind: "quota", authFailure: true}` — the same outcome that advances the outer agent order. Rules out the zero-exit path having no auth defense.
- Match against the invocation's stderr (where the auth failure appears), not agent stdout — agent stdout can legitimately quote phrases like "log out and sign in". Rules out a false positive from a run that merely mentions the text.
- `read-only`/quota behavior on the zero-exit path is otherwise unchanged; a productive zero-exit invocation still settles `ok`. Rules out reclassifying healthy runs.

## Acceptance criteria

- [ ] A `settleZeroExit`/classifier test proves a zero-exit invocation whose stderr matches `codexCredentialAuthPatterns` with no file changes classifies `{kind: "quota", authFailure: true}`; it fails against the current quota-only zero-exit check.
- [ ] A test proves a zero-exit invocation that only *quotes* an auth phrase on stdout (with real work) still settles `ok` — no false positive.
- [ ] An agent-order test proves the auth-classified result advances to the next configured agent rather than settling the run `invocation_error`.
- [ ] `bun run typecheck` and `bun run test:v1` + `bun run test:v2` + `bun run test:integration:v2` pass (shared surface).

## Documentation updates

- `v2/docs/v1-behaviors.md` and `v1/docs/quota-signals.md` — the zero-exit codex path now treats credential-auth stderr as an agent-advancing signal.
