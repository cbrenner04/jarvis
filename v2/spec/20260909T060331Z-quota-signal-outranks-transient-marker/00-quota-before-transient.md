# 00 - Classify quota and credential signals before transient ones

## Problem

`settleNonZeroExit` (`shared/invocation/agents.ts`) tests `isTransientSignal` first over `errBuf + outBuf`. When a codex exit carries a transient-looking line anywhere in its diagnostics (the #3372 tail: a `shell_snapshot` error, then `ERROR: You've hit your usage limit`), the explicit quota banner is ignored, `runAgent` retries the same binding through `TRANSIENT_RETRY_CAP`, and the final result is `error` — no agent-order advance, and a run stranded over finished work. A quota-exhausted or de-authenticated agent does not recover on retry, so transient handling must never pre-empt those signals.

## Decisions

- Non-zero exit classification order becomes **credential/auth → quota → transient → model configuration → error**; rules out a transport marker masking a quota or auth banner.
- Transient detection itself is unchanged (`transientPatterns`, opencode transport patterns, retry cap and backoff); only its precedence moves; rules out weakening transport-retry coverage.
- The zero-exit path is untouched (it already checks auth then quota, and has no transient branch).

## Acceptance criteria

- [ ] `shared/invocation/agents.test.ts` test `a codex exit whose diagnostics carry a transient marker before the usage-limit banner classifies quota` drives `createResolvedAgentBinding(...).invoke` with stderr `"... connection reset ...\nERROR: You've hit your usage limit ..."` on exit 1 and asserts `{ kind: "quota" }` after exactly one spawn; it fails against the current transient-first order.
- [ ] A test proves a codex credential/auth line alongside a transient marker still classifies `quota` with `authFailure: true`.
- [ ] A test proves a transient-only stderr still retries and settles `error` after the cap (existing coverage may be cited).
- [ ] `bun run typecheck`, `bun run test:shared`, `bun run test:integration:shared`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/quota-signals.md` — § Classification order: the new non-zero order and the multi-line codex tail shape (noise line above the banner) as a real sample.
