# Codex skip-git-repo-check and trusted-directory refusal classification

## Primary implementation surface

Execution loop: shared codex invocation adapter and exit classifier in `shared/invocation/agents.ts` (`runCodexBinding`'s `buildArgv`, `codexCredentialAuthPatterns`, `isCredentialAuthSignal`).

## Problem

v2 spawns `codex exec` without `--skip-git-repo-check`, so codex ≥0.150 refuses git-disabled staging dirs under `~/.jarvis/intent-work/` and exits 1; the refusal reaches `settleNonZeroExit` matching no signal and settles `{kind: "error"}`, which `executeWithQuotaFallback`'s default `shouldAdvance` (`kind === "quota"`) treats as terminal — killing intent/plan stages on codex-first orders instead of trying sibling agents (#3106).

## Decision ledger

- Emit `--skip-git-repo-check` unconditionally from shared codex `buildArgv`, in every sandbox mode; rules out per-callsite conditional plumbing keyed on git-enablement and `trust_level` config overrides (verified ineffective 2026-08-29). Codex ≥0.150 exhibited the refusal in a live check on 2026-08-29, and `--skip-git-repo-check` is a documented `codex exec` option.
- Classify the refusal as `{kind: "quota", authFailure: true}` by extending `codexCredentialAuthPatterns` (read by `isCredentialAuthSignal`); rules out widening `shouldAdvance` to advance on `error`, which would change every agent's terminal-failure policy to fix one codex string.
- Anchor the pattern on `--skip-git-repo-check was not specified`, not the bare phrase `trusted directory`; rules out matching unrelated codex trust/approval prose as an advance signal.
- Keep the belt-and-suspenders classifier even though the flag should prevent the refusal; it covers a codex build that accepts the flag but still enforces the check, or a future trust model that reintroduces this refusal. A binary that rejects the flag emits an unexpected-argument error and is not covered by this pattern.
- Accept matching the credential-auth patterns against combined stderr and stdout. A non-zero codex run that echoes the anchor only on stdout can falsely advance one rung; that cost is accepted because a false terminal kills the stage.
- Accept the terminal `quota_exhausted` / `retry_later` copy when a codex-only or codex-last order exhausts every rung on this refusal, even though the condition does not clear with quota reset. The stderr-persistence sibling intents are related compensating work, not prerequisites; this spec remains independently correct without them.
- `v2/docs/operator-runbook.md` carries no codex git-disabled caveat on main (verified 2026-08-29), so no runbook edit is owed.
- Out of scope: generic advance-on-`error`/`model_config` policy, per-project agent orders, v1's local codex adapter (`v1/src/agents/codex.ts`), codex transport-throttling (429) classification.

## Tasks

- Emit `--skip-git-repo-check` on every shared `codex exec` argv (all sandbox modes).
- Add the trusted-directory refusal pattern to `codexCredentialAuthPatterns`.
- Update all five full-argv pins: three in `shared/invocation/agents.test.ts` and two in `v2/src/daemon/write-loop-codex-sandbox-mode.test.ts`; add the classification and fallback-advance pins in `shared/invocation/agents.test.ts` using its existing fake-spawn harness.
- Align durable docs per Documentation updates.

## Acceptance criteria

- [ ] `shared/invocation/agents.test.ts` proves the codex adapter argv includes `--skip-git-repo-check` in the default `workspace-write` invocation and in the `danger-full-access` and `read-only` invocations, and `v2/src/daemon/write-loop-codex-sandbox-mode.test.ts` updates both full-argv pins to include the flag; all five pins fail against the pre-fix argv.
- [ ] `shared/invocation/agents.test.ts` proves a codex binding whose spawn exits 1 with stderr `Not inside a trusted directory and --skip-git-repo-check was not specified.` resolves `{kind: "quota", stderr: <that stderr>, authFailure: true}`; it fails against current classification, which settles `{kind: "error", exitCode: 1}`.
- [ ] A new `shared/invocation/agents.test.ts` test uses its existing fake-spawn harness to drive `executeWithQuotaFallback` with two `createResolvedAgentBinding` codex bindings — the first spawning exit 1 with the trusted-directory stderr, the second settling `ok` — and asserts two attempts ran and `final.result.kind === "ok"`; it fails against current classification, where the refusal settles `error` and the chain stops at one attempt.
- [ ] `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, and `bun run test:integration:v2` pass (shared surface).

## Documentation updates

- `v2/docs/shared-invocation.md` — the literal resolved-codex argv line gains `--skip-git-repo-check`; note the trusted-directory refusal settles `quota` with `authFailure: true` so fallback advances.
- `v1/docs/quota-signals.md` — `codexCredentialAuthPatterns` audit list gains the trusted-directory refusal entry (Matched, 2026-08-29), flagged as v2-shared-classifier only; v1's local codex adapter neither passes the flag nor classifies the string.
- `v2/docs/v1-behaviors.md` — add a `[v2 divergence]` sub-bullet under the existing `codex` adapter entry: v2's shared codex argv appends `--skip-git-repo-check` and classifies the trusted-directory refusal as advancing `quota`/`authFailure`; v1 does neither.
