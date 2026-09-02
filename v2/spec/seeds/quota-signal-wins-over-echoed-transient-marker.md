---
name: quota-signal-wins-over-echoed-transient-marker
---

# A quota exit misclassified as transient skips agent fallback and strands the run silently

## Problem

`settleNonZeroExit` (`shared/invocation/agents.ts`) classifies a non-zero agent exit in this order:

```ts
if (isTransientSignal(...)) settle({ kind: "error", ... });
else if (isCredentialAuthSignal(...)) settle({ kind: "quota", authFailure: true });
else if (isQuotaSignal(...)) settle({ kind: "quota", ... });
```

Transient wins over quota, and the check runs over the **full** `errBuf + outBuf`. Two consequences:

- An explicit quota line is ignored whenever anything anywhere in the diagnostics matches a transient pattern. `runAgent` then retries to `TRANSIENT_RETRY_CAP` and settles `error`, which `executeWithQuotaFallback` does not advance on (`shouldAdvance` defaults to `result.kind === "quota"`), so the next configured rung is never tried.
- The diagnostics include whatever the agent echoes. Codex can echo the entire prompt on stderr, so any prompt embedding a diff, lockfile, or build artifact can carry `\b50[234]\b` beside a transport word and trip the transient patterns on content, not on a real transport failure.

The **zero**-exit path in the same file already checks credential/auth then quota with no transient check at all. The two paths disagree about precedence.

Separately, the resulting row settles `paused` + `invocation_error` + `resumable: false` + `nextAction: stop`, which is terminal in every practical sense — but `deriveOperatorIncidents` derives incidents only from terminal run statuses plus `blocked`/budget rows, so **nothing fires**. The run log's own `boundary_committed` records `runStatus: "failed"` while the row says `paused`: the row and the log disagree.

## Evidence (issue #3372, 2026-09-02)

Run `27357953-bb60-4887-accb-5cae15fa1844`, project `homestead-service`, step `implement~shrink`. Same run, same codex limit, different outcomes per step:

```text
role=implement  codex  binding_index=0  exit_kind=quota  2493ms  → cursor binding_index=1 exit_kind=ok
role=implement  codex  binding_index=0  exit_kind=quota  2400ms  → cursor binding_index=1 exit_kind=ok
role=shrink     codex  binding_index=0  exit_kind=error  exit_code:1  21011ms   (no further rows)
```

The write steps fell back correctly; the shrink step did not. Applying `guardedStatusPatterns([502, 503, 504, 529])` to the session log yields 16 hits, all on the branch diff of `tsconfig.build.tsbuildinfo` — a tracked single-line JSON build artifact the shrink prompt embeds as `BRANCH_DIFF`, containing a bare `502` as a file index. The quota line (`You've hit your usage limit`) sat at byte 1,022,674 of stderr and never got its turn. Timing corroborates: 4 spawns × ~2.4s + 7s backoff ≈ 21.0s.

The workflow was stranded with no live row, no PR, and no sink incident; the operator hand-finished it (homestead-service#2).

## Rarity, blast radius, and why v1 shrugs this off

Quota classification is not broken. Codex telemetry records **1,458 `quota` against 16 `error` all-time** (2026-09-02 alone: 212 vs 2), so the quota path fires correctly ~99% of the time. This defect is the ~1% miss: it needs quota exhaustion *and* diagnostics that happen to carry transient-looking bytes. Its cost is not a wasted retry — the misread is terminal, so one miss kills a whole pipeline and skips every downstream stage.

The transient-before-quota ordering is **not a regression** — it has been there since the first commit of both engines (`v1/src/agents/spawn.ts:91`, and `shared/invocation/agents.ts` from #1192). v1 tolerates it because it has a second-chance layer that v2 never received:

`applyQuotaFallbackToAgentResult` (`v1/src/agents/quota.ts`) takes a settled `kind: "error"` result and upgrades it to `quota` when a weak-quota signal is present, **guarded** by a caller-supplied progress predicate — patch passes "no iteration progress", plan passes "git porcelain unchanged for this agent invocation". A first-pass misclassification is therefore recoverable in v1: nothing happened, the diagnostics smell like quota, so treat it as quota and advance.

`grep -rn "applyQuotaFallback|isWeakQuotaSignal|weakQuota" v2/src shared` returns **nothing**. The shared-invocation port carried the classifier and its ordering across but left the rescue layer behind, so in v2 a single misclassification is terminal.

So the ordering is not what changed, and fallback should **not** advance on any error — a blanket advance would mask real failures by silently retrying them on another agent. The primary fix is precedence plus scoping the transient check to a bounded stderr tail, which makes the miss rarer. The v1 parity layer is secondary: it is why a rare miss is a hiccup in v1 and terminal in v2.

## Decisions

- **Quota and credential/auth signals take precedence over transient markers.** A quota-exhausted agent will not succeed on retry; retrying burns the cap and then blocks fallback. Rules out the current transient-first order.
- **Scope the transient check to a bounded tail of stderr**, not the full concatenated diagnostics, so echoed prompt content cannot classify an exit. Rules out matching transient patterns against arbitrary agent-echoed input.
- Align the non-zero-exit path's precedence with the zero-exit path's existing quota/auth-first order. Rules out leaving the two settlement paths inconsistent.
- **Restore v1 parity: a guarded weak-quota upgrade.** An `error` result may be re-read as `quota` when a weak-quota signal is present **and** a caller-supplied progress predicate confirms nothing happened (no iteration progress / unchanged git porcelain), matching `applyQuotaFallbackWhenAllowed`. Rules out both the current no-recovery behavior and a blanket advance-on-any-error, which would mask genuine failures.
- **A non-live, non-resumable `invocation_error` row must produce an operator incident.** Either settle it `failed` (matching what the run log already records) or derive a stranded-run incident. Rules out a run that is terminal in practice notifying nothing.

## Acceptance criteria

- [ ] A non-zero exit whose diagnostics contain both a quota line and a transient marker settles `quota`, not `error` — pinned by a test that fails against the current transient-first order.
- [ ] A quota line appearing only in echoed prompt content beyond the scoped stderr tail still settles `quota`, and a `502` appearing only in echoed prompt content does not settle `error` as transient — pinned by a test.
- [ ] A genuine transport failure (transient marker in the stderr tail, no quota or auth match) still settles `error` and still retries to the cap — pinned by a test, so the fix does not disable transient retry.
- [ ] `executeWithQuotaFallback` advances to the next binding for the misclassified case above — pinned by a test asserting the second rung is invoked.
- [ ] An `error` result carrying a weak-quota signal is upgraded to `quota` and advances only when the progress predicate reports no progress; with progress reported it stays `error` and does not advance — pinned by tests covering both directions.
- [ ] A non-live `invocation_error` row that is not resumable produces an operator incident — pinned by a test that fails against the current derivation.
- [ ] `bun run typecheck` and the full `bun run test` pass (touches `shared/**`).

## Documentation updates

- `v1/docs/quota-signals.md` — classification precedence: quota and credential/auth are decided before transient, and the transient check reads a bounded stderr tail.
- `v2/docs/daemon-host.md` — § Operator notifications: non-resumable `invocation_error` rows surface as operator incidents.
