## Verdict — required refinements

### Fix contract (`iteration.ts:657`)

- Pin that `tryFinishSpecIfDone` returning `null` yields `{ kind: "continue" }` **before** any `?? 0`, `completionLoopbackSignal` handling, `completed-spec` telemetry, or terminal `return { kind: "return", exitCode: … }` — rules out post-coalesce branching or falsy-wide handling that would still emit false completion telemetry.
- Add decision: only `null` loops back; numeric returns (`0`, `6`, gate loopback codes) keep the existing finish path — rules out treating all falsy/`null`-like outcomes uniformly.

### Regression test contract

- Pin `maxIterations >= 2` in task/AC/decisions — rules out a `maxIterations: 1` fixture that passes on “no exit 0” without ever reaching subspec 01.
- Strengthen AC beyond `code !== 0`: committed index shows `- [x]` on 00 and `- [ ]` on 01; first agent prompt references subspec 01; subspec-00 commit present in git history — rules out single-subspec false positives (existing test at `run.test.ts` ~3388 legitimately exits `0` with zero agent calls).
- Add preservation AC citing `` `run.test.ts` “uncommitted ticks present at iteration start…” stays green `` — rules out paraphrased “`?? 0` sites unchanged” AC that spec-guidance rejects for refactor/preservation claims.
- Replace preservation AC for `before === 0` / `after === 0` paths with cited existing green tests if any; otherwise drop the paraphrase AC — rules out unverifiable “unchanged” prose.

### Documentation (per `v2/docs/documentation-standard.md`)

- Reframe doc deliverables: durable operator/workflow symptom belongs in `v2/docs/` (`v1-behaviors.md` required; extend `v1/docs/run-loop.md` uncommitted-ticks / exit-6 row for multi-subspec false-`criteria-complete` and post-subspec continuation) — rules out `v1/docs/operator-runbook.md` as the sole durable home (Jarvis-on-Jarvis meta-doc).
- If keeping `v1/docs/operator-runbook.md`: treat as transient dogfooding stopgap with explicit cleanup trigger on spec merge; target a real existing section, not `## Known gotchas` (that heading is scaffold-only, not in this file) — rules out orphan stopgap text and invalid section anchors.
- Triage symptom must pair `criteria-complete` + `iterations: 0` on a multi-subspec index with **absence** of harness `spec complete` on stdout — rules out `iterations: 0` alone, which is ambiguous.

### Decisions ledger (load-bearing additions)

- `null` → `continue` only at the uncommitted-ticks finish call site; other `tryFinishSpecIfDone` call sites unchanged.
- Regression test uses `maxIterations >= 2`.
- Durable symptom cataloged in `v2/docs/`; any `operator-runbook.md` entry is stopgap with merge cleanup if retained.
- Align intent and AC on “agent targets subspec 01” for the fixture (drop “or next harness pass” hedge unless harness-only continuation without agent is an explicit pass condition).

### Scope (optional, low)

- One-line note that the uncommitted-ticks block is `git: true` only — rules out implying the fix applies when `gitEnabled` is false.

---

**Rationale summary:** Core intent (one bounded fix, one subspec, behavior catalog update) is sound. Gaps are contract precision: fix ordering prevents reintroducing false completion telemetry; test pins prevent `maxIterations: 1` and single-subspec false greens; doc placement aligns with documentation-standard and runbook maintenance rules; preservation ACs must cite tests per spec-guidance. No scope expansion beyond these refinements.
