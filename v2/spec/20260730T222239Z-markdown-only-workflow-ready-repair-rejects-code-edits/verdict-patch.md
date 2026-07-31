Verifying the advocate's fail-closed and recovery claims against the implementation before issuing the verdict.
## Verdict: refinements required

The layered fence, distinct error prefix, frozen-root persistence on the happy path, intent/plan regressions, and shared `enforcePersistedReadyGateRepairFence` wiring are sound. The branch is **not merge-ready** until the fail-closed gap below is closed and docs/tests align with subspecs `01` and `02`.

### 1. Fail-closed markdown-only provenance (required)

**Outcome:** On intent/plan (markdown-only) runs that have entered ready-gate repair, missing, empty, or invalid `markdownOutputRoots` in persisted fence provenance must yield retryable `completion_commit_failed` — not pass through to commit or publish.

**Why:** Subspecs `01` and `02` explicitly require fail-closed reconstruction when markdown-only provenance is absent or invalid. Today `validateReadyGateRepairCompletion` applies the markdown layer only when `markdownOutputRoots` is defined and non-empty; recovery and live repair iteration enforcement both call through this path. A row with `allowedPaths` and `outcomeKind: completion_commit_failed` but no (or empty) `markdownOutputRoots` can still commit in-scope non-`.md` paths that pass the run-diff allowset. `parseReadyGateRepairFenceProvenance` treats `markdownOutputRoots: []` as valid, making that bypass durable. This is the same bypass class the recovery subspecs were written to close.

**Scope:** All production routes that enforce the persisted fence today — live repair iteration enforcement, completed-run retry, `jarvis run resume`, and review-mutation recovery — must treat “markdown-only run + repair fence active + markdown roots missing/empty/invalid” as a fence failure, not as “skip markdown layer.”

### 2. Fail-closed at first repair freeze on markdown-only runs (required)

**Outcome:** When a markdown-only workflow enters ready-gate repair, failure to derive or persist non-empty markdown output roots must fail the repair boundary (`completion_commit_failed`), not silently disable the markdown layer for the rest of the loop.

**Why:** `deriveMarkdownOutputRoots` returns `undefined` when derivation yields zero roots, and `persistReadyGateRepairFence` omits the field when roots are absent or empty. Combined with outcome 1, a misconfigured landing contract or failed derivation leaves the fence permanently off for that run — including on the live repair loop before any recovery path runs. Subspec `00` requires roots persisted at first freeze; subspec `01`’s fail-closed rule must cover corruption or partial persist at freeze time, not only at recovery.

### 3. Regression coverage for the bypass class (required)

**Outcome:** Focused tests must prove that omitting or emptying persisted `markdownOutputRoots` on a markdown-only run cannot commit or publish a rejected non-markdown path on:

- completed-run retry,
- `jarvis run resume`, and
- review-mutation recovery.

Tests must fail when markdown-only fail-closed enforcement is removed or bypassed (mirroring existing bypass/invert patterns for the run-diff fence).

**Why:** Subspec `01` AC requires recovery regressions that “fail against recovery that omits or bypasses the markdown-only layer.” Existing recovery tests seed complete provenance and only prove bypass via the full-fence test hook — they do not exercise missing/empty markdown roots. Without these regressions, outcome 1 can regress undetected.

### 4. Operator docs must match fail-closed semantics (required)

**Outcome:** `v2/docs/write-behavior.md` must document that markdown-only runs with active repair-fence provenance fail closed when markdown output roots are missing, empty, or unparseable — distinct from the parent rule that a null fence column means repair never ran. Recovery reconstruction must not re-derive roots from the dirty worktree.

**Why:** Subspec `01` AC requires documentation of “markdown-only provenance persistence, fail-closed reconstruction, and the completed-run retry/resume boundary.” Current text describes roots “when present” and inherits the null-column pass-through rule; that contradicts subspec `01`/`02` decisions and leaves operators without accurate recovery semantics.

---

### Not required for merge (defend as-is)

- Canonical staging-dir equality check (`.jarvis-intent-stage` / `.jarvis-plan-stage`) — matches spec’s frozen root names; production contracts use those paths.
- Review-mutation regression seeding persisted provenance directly rather than full repair→review E2E — matches parent repair-fence pattern; live freeze is covered in `write-loop.test.ts`.
- `publishCalls === 1` without git-history assertions — fence runs before `commitRepairAndRepublish`; ordering prevents commit on rejection.
- Plan-only positive-path repair test — spec requires one plan rejection proving `durablePath` / `.jarvis-plan-stage/` wiring, not a plan positive path.
- Case-sensitive `.md` suffix — matches spec wording.
- Surviving-mutation repair exclusion — pre-existing, documented scope boundary.
- Top-level `intent.md` unchecked ACs — superseded by completed index subspecs; process drift only.

### Secondary improvements (optional after outcomes 1–4)

- Automated integration invert proving all three intent surface-class rejection tests red when only the markdown layer is disabled (subspec `00` invert AC is ticked via helper mutation checkpoints only).
- `promptId`-only classification fixture without `landing`.
- Dedicated gate-only exhausted-red resume markdown-only regression (shared helper coverage exists; worth adding once fail-closed lands).
- Unit tests for `deriveMarkdownOutputRoots` edge cases.