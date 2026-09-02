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

## Decisions

- **Quota and credential/auth signals take precedence over transient markers.** A quota-exhausted agent will not succeed on retry; retrying burns the cap and then blocks fallback. Rules out the current transient-first order.
- **Scope the transient check to a bounded tail of stderr**, not the full concatenated diagnostics, so echoed prompt content cannot classify an exit. Rules out matching transient patterns against arbitrary agent-echoed input.
- Align the non-zero-exit path's precedence with the zero-exit path's existing quota/auth-first order. Rules out leaving the two settlement paths inconsistent.
- **A non-live, non-resumable `invocation_error` row must produce an operator incident.** Either settle it `failed` (matching what the run log already records) or derive a stranded-run incident. Rules out a run that is terminal in practice notifying nothing.

## Acceptance criteria

- [ ] A non-zero exit whose diagnostics contain both a quota line and a transient marker settles `quota`, not `error` — pinned by a test that fails against the current transient-first order.
- [ ] A quota line appearing only in echoed prompt content beyond the scoped stderr tail still settles `quota`, and a `502` appearing only in echoed prompt content does not settle `error` as transient — pinned by a test.
- [ ] A genuine transport failure (transient marker in the stderr tail, no quota or auth match) still settles `error` and still retries to the cap — pinned by a test, so the fix does not disable transient retry.
- [ ] `executeWithQuotaFallback` advances to the next binding for the misclassified case above — pinned by a test asserting the second rung is invoked.
- [ ] A non-live `invocation_error` row that is not resumable produces an operator incident — pinned by a test that fails against the current derivation.
- [ ] `bun run typecheck` and the full `bun run test` pass (touches `shared/**`).

## Documentation updates

- `v1/docs/quota-signals.md` — classification precedence: quota and credential/auth are decided before transient, and the transient check reads a bounded stderr tail.
- `v2/docs/daemon-host.md` — § Operator notifications: non-resumable `invocation_error` rows surface as operator incidents.
