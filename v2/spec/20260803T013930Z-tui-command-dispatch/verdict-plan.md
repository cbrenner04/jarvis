Checking module boundaries and the referenced brief section to ground the verdict.
## Verdict: required refinements

### 1. Split subspecs by module boundary (blocker)

`00-daemon.md` bundles CLI admission wiring, TUI dispatch, dock projection, expansion, and most tests. `01-cli.md` repeats the same executable work without owning it. “Daemon” is wrong — this spec does not change daemon behavior.

**Required:** Replace the two subspecs with independently implementable slices aligned to module boundaries (e.g. admission callback binding at the CLI/TUI entry seam, typed async dispatch in monitor controls, status-row projection). Each slice must have its own baseline-failing tests and `@mutate` coverage for guards it introduces. Re-link all replacements from `index.md`. Every task and acceptance outcome from the current draft must appear exactly once across the new subspecs — no duplication, no gaps.

**Rationale:** Spec guidance requires atomic, one-boundary subspecs with per-subspec failing-test ACs. The current split would let `01-cli` pass before its work exists and blocks serial, reviewable implementation.

---

### 2. Define pending-admission lifecycle (blocker)

The intent requires non-blocking detached admission, but the spec does not define behavior while a start is in flight: repeated `Enter`, buffer edits, a second submission, settlement arriving after newer editor state, or updates after monitor teardown. “Cancellation out of scope” only excludes explicit cancel — it does not settle concurrency.

**Required:** State an explicit concurrency policy (e.g. single in-flight admission, defined editor behavior during pending, stale settlements must not overwrite newer command/editor/feedback state, no post-close rendering) and add acceptance criteria with tests that fail on the inert baseline.

**Rationale:** Without this, implementers can ship racey or confusing dock behavior that still satisfies “non-blocking” and “no `pipeline_wait`.”

---

### 3. Pin selection semantics during pending start

Intent says post-start selection stays unchanged; the draft could be read as “restore captured selection on settlement.”

**Required:** Clarify that dispatch never mutates selection; settlement must not revert selection changed by the operator while admission is pending. Add a test proving navigation during pending admission survives settlement.

**Rationale:** Prevents smuggling focus-and-reveal or selection-restore into “unchanged selection.”

---

### 4. Make status-row coexistence testable

The draft requires command outcomes and refresh-owned RPC feedback to both remain visible, but not ordering, labeling, or truncation when both are present.

**Required:** Specify how command success/error and daemon/RPC feedback coexist on the fixed four-row status projection (precedence, ordering, labels, narrow-width behavior). Add a pinning test with a single observable contract.

**Rationale:** “Both observable” is not verifiable without a defined presentation rule; existing projection behavior is being intentionally changed.

---

### 5. Name expansion-selection feedback

Expansion failure ACs say “named feedback” for absent, run-leaf, unattributed, and stale non-expandable selections without stable identifiers.

**Required:** Define exact feedback codes or a typed discriminant-to-message contract for each unsupported selection case, and pin them in tests.

**Rationale:** Intent requires named parse/admission feedback; expansion failures need the same contract so tests and operators get stable outcomes.

---

### 6. Exercise both start seed forms through the dispatch seam

Path-seed and text-seed may be covered separately upstream; the new translation/dispatch layer can break one arm.

**Required:** Acceptance criteria for start dispatch must prove both path-seed and text-seed submissions reach detached admission with correct typed project/seed through the production TUI path.

**Rationale:** Parity with `jarvis pipeline start` is the core intent; one seed variant is insufficient coverage at the new seam.

---

### 7. Prove parse-once on submission

The central decision is single parse per submit; “one admission” does not imply “one parse.”

**Required:** Add an explicit parse-invocation assertion (or equivalent structural seam) in submission tests.

**Rationale:** Intent explicitly rules out multiple parsers or Ink verb matching; this guard needs direct verification.

---

### 8. Give each code-changing subspec its own verification gate

`01-cli.md` currently lacks mutation checkpoints and could pass once `00` lands. Global `typecheck` / `test:v2` / `test:integration:v2` ACs live only in `00`.

**Required:** After the split, each subspec that changes executable code carries its own baseline-failing test AC, applicable `@mutate` directives for its guards, and the verification suites it touches. Docs-only slices carry only their doc ACs.

**Rationale:** Failing-test and mutation-checkpoint rules apply per runtime-behavior subspec, not once for the whole feature.

---

### 9. Make `tui-overhaul-brief.md` updates explicit

The doc AC says “mark command-dock dispatch shipped” but does not require fixing known stale content: `expand`/`collapse` still documented as toggle (line 181), and “no caller” dispatch language (lines 217–219).

**Required:** Acceptance criteria must require both corrections — explicit expand/collapse semantics and updated dispatch-shipped status — not a vague “mark shipped.”

**Rationale:** Intent documentation updates are meant to record shipped behavior; leaving contradictory brief text defeats the parity catalog’s purpose.