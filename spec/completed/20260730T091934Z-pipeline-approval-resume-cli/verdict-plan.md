Validating key claims against the codebase and sibling specs before issuing the verdict.
# Verdict: required refinements

## 1. Help and usage regression coverage (`00`, `01`)

**Outcome:** Both subspecs must include acceptance criteria that the expanded `jarvis pipeline` family—shared `PIPELINE_USAGE`, `jarvis help pipeline`, and per-subcommand usage/help—lists and documents `approve`, `reject`, and `resume` alongside existing commands.

**Rationale:** The sibling list/wait subspec already pins help as a failing-test AC. Task checklists mention usage strings, but without ACs an implementer can satisfy RPC wiring while leaving stale help text (`start|list|wait` only). This is a real regression surface for operator discoverability.

---

## 2. Awaiting-pipeline resume success path (`01`)

**Outcome:** Resume acceptance criteria must cover the success path for an `awaiting-approval` pipeline: `pipeline resume` issues `pipeline_resume`, exits `0` on `kind: "resumed"`, silent stdout—distinct from the failed-pipeline path and terminal refusals.

**Rationale:** Intent prerequisites and problem text both include awaiting resume; daemon spec `02` already ACs awaiting behavior. The CLI spec currently only asserts failed-path preservation and terminal refusals, leaving a gap between intent and verifiable CLI contract.

---

## 3. Invocation-ID preservation AC wording (`01`)

**Outcome:** Replace the CLI-layer paraphrase (“prior succeeded stage `workflowInvocationId` unchanged across resume”) with either:
- a preservation AC citing the daemon pinning tests in `pipeline-execution.test.ts` (and/or `daemon-pipeline-resume.test.ts`) stay green, **or**
- drop the paraphrase and limit CLI ACs to RPC admission (`pipeline_resume`, exit `0` on `kind: "resumed"`).

Do not require a hollow single-RPC stub to re-prove daemon-owned invariants.

**Rationale:** Spec guidance requires preservation ACs to anchor on existing pinning tests, not restated behavior the CLI does not own. Intent AC #2 is satisfied at the product level when daemon preservation holds and CLI resume correctly forwards to it.

---

## 4. Duplicate/racing approval refusal exemplar (`00`)

**Outcome:** Approve/reject acceptance criteria must include at least one refused duplicate or racing decision (e.g. daemon reason `invalid_decision`): named reason on stderr, non-zero exit, no success stdout.

**Rationale:** Intent decision #2 explicitly requires first-writer wins with named refusal for duplicates/races. Current ACs only exemplify `status_not_awaiting`; guard-inversion is generic but does not demonstrate intent decision #2 at the CLI boundary.

---

## 5. “No later dispatch” AC scope (`00`)

**Outcome:** Narrow or replace the AC claiming a refused approve/reject “does not dispatch a later stage” so it is honestly verifiable at CLI scope. Acceptable forms:
- preservation AC citing daemon dispatch/refusal tests in `pipeline-execution.test.ts` / `daemon-pipeline-approval.test.ts` stay green, **or**
- a CLI test using a stateful two-RPC stub (e.g. refused approve followed by `pipeline_list` snapshot showing later stages still undispatched).

Remove the tautological single-RPC-stub formulation.

**Rationale:** Intent AC #4 is valid product behavior, but dispatch is daemon-owned. A one-call stub that returns `refused` cannot prove non-dispatch; the current wording invites hollow tests or over-scoped integration work.

---

## 6. Detached admission semantics for approve/reject (`00`)

**Outcome:** Approve/reject decisions and documentation must state that exit `0` means the decision was durably admitted, not that the pipeline finished—mirroring resume’s detached-admission contract and pairing with `pipeline wait` / `pipeline list` for progress.

**Rationale:** Resume already pins this; approve/reject only say “silent stdout on `applied`.” After `pipeline wait` boundary JSON, operators can misread exit `0` as terminal completion without explicit detached semantics.

---

## 7. Operator-runbook operator guidance (`00`, `01`)

**Outcome:** Documentation tasks must cover:
- **Stage ID discovery:** concrete fields from `pipeline wait` (`{kind:"awaiting-approval",stageId}`) and `pipeline list` stage rows—not vague “read awaiting-approval.”
- **`jarvis pipeline resume` vs `jarvis run resume`:** workflow-run resume vs daemon pipeline resume.
- **Duplicate/stale decisions:** daemon may return `invalid_decision` or `status_not_awaiting` for races; CLI forwards verbatim.

**Rationale:** Intent is operator-usable CLI contracts; runbook tasks are currently thinner than the list/wait sibling and omit workflows intent decisions assume.

---

## 8. Same-seam serial dependency (`01`)

**Outcome:** `01` prerequisites (or index routing note) must state that `00` lands first on the shared `pipeline.ts` / `pipeline.test.ts` / `cli.test.ts` / docs seam before resume work begins.

**Rationale:** Spec guidance requires same-seam siblings serially. Both subspecs touch identical files; explicit ordering prevents parallel implement conflicts and stale `PIPELINE_USAGE` merges.

---

## 9. Malformed result-envelope behavior (`00`, `01`)

**Outcome:** Decisions for approve, reject, and resume must state that unknown or malformed daemon result envelopes follow existing `pipeline wait` / `pipeline list` patterns (`invalid daemon response` on stderr, exit `1`)—not only `applied`/`refused` and `resumed`/`refused`.

**Rationale:** Decisions name only the happy/refused kinds; implementers need an explicit contract for parse failures without inventing a separate error vocabulary.

---

## 10. Whitespace-only positional usage errors (`00`, `01`)

**Outcome:** Acceptance criteria must prove missing, extra, or whitespace-only positionals are usage errors before daemon connect—consistent with `pipeline wait` empty-ID coverage.

**Rationale:** Decisions require non-empty IDs after trim; without usage ACs that guard is only prose.

---

## Held without change

- CLI-only scope; no integration requirement in this spec.
- Per-command `cli.test.ts` dispatch entries satisfy bundled intent AC #5 when both subspecs complete.
- Verbatim `reason` forwarding plus guard-inversion covers refusal breadth without enumerating every daemon code.
- Subspec split (approve/reject vs resume) and index order are appropriate; do not split further.
- SIGINT omission for quick mutating RPCs is acceptable.