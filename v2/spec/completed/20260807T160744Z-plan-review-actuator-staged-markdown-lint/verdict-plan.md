Validating advocate claims against the workflow-runner call graph before issuing the verdict.
## Verdict: required refinements

### 1. Pin all promotion admission paths for the lint guard

The spec must require one shared pre-landing staged-Markdown lint step for `plan-tree` and `intent-stage` kinds, invoked from **every** caller that reaches `landReviewedPublicationOutput` on those kinds — not only `landReviewedOutputOrFail`. At minimum: `landReviewedOutputOrFail`, `finishReviewedLanding`, and `resumePopulatedIntentPublication`. Resume must lint without re-invoking the actuator (replay-finalization-only semantics); first-pass paths lint after actuator edits.

**Why:** `finishReviewedLanding` and `resumePopulatedIntentPublication` call `landReviewedPublicationOutput` directly today. Wiring only `landReviewedOutputOrFail` leaves checkpoint and resume bypasses where actuator-introduced violations can still promote.

---

### 2. Pin reprompt retry control flow, not only the lint gate

The spec must state **where** post-actuator lint failure turns into a bounded actuator retry with reprompt injection — analogous to existing actuator-only retry admission on the review-debate path. A lint failure that only blocks landing (terminal `invocation_failure` / `landing_failed`) does **not** satisfy the reprompt acceptance criterion.

**Why:** The write loop's `continue` on `pendingStagedMarkdownLintReprompt` has no review-path equivalent. Work currently names the outcome ("retry the actuator") without the loop seam, so an implementer can satisfy the block AC while failing the reprompt AC.

---

### 3. Resolve budget semantics enough for the reprompt AC to be satisfiable

The deferred "pin when wiring" item must be tightened: either (a) decide in Work/decision ledger whether lint reprompt consumes `maxCycles` or a separate bounded counter (write-step parity favors a separate counter), or (b) explicitly allow elevated review budget / injected counter in tests and require the production choice before criteria pass. Silence leaves the reprompt AC satisfiable only by guesswork under default `reviewPasses: 1`.

**Why:** Spec guidance requires agent-verifiable acceptance criteria. An AC asserting retry without terminal settlement on first miss is unsatisfiable if budget is unpinned and defaults to one cycle.

---

### 4. Tighten acceptance criteria to match Work and the motivating incident

- **Coverage:** Require at least one `review-debate` (plan debate) workflow in the pinning tests — the path that produced the observed `MD038`. Intent coverage may be same or companion test; "plan **or** intent" alone lets implementers skip debate.
- **Reprompt injection:** The reprompt AC must assert the second actuator invocation carries injected reprompt content (rule id, offending path, staging context) — not only a `staged_markdown_lint_reprompt` log event and retry count.
- **Reachability wording:** Replace "lints only the pre-actuator draft" with language that pre-fix code has **no post-actuator review-path re-lint**, so violations introduced by the actuator reach landing.
- **Block outcome:** Assert no durable promotion (no spec-path write / completion commit) while the violation remains; optionally align with existing deferred-landing retention patterns.

**Why:** Work already requires plan debate + intent; AC/work mismatch invites under-coverage. Weak reprompt AC allows hollow retry wiring. Reachability wording misstates baseline behavior per spec-guidance invariant rules.

---

### 5. Add `invocation_error` fail-closed parity

Decision ledger must state that review-path `lintStagedMarkdown` `invocation_error` follows write-step fail-closed semantics (non-retryable landing failure), reusing the same function and error kinds.

**Why:** Sibling `plan-intent-write-steps-lint` already pins this; silence risks divergent operator experience on harness/tooling failure.

---

### 6. Clarify scope exclusions

Out of scope must explicitly include non-durable profile review (`landing.kind: "none"`). Lint gating applies only to `plan-tree` and `intent-stage` durable landing.

**Why:** Four call sites reach `landReviewedPublicationOutput`; only three matter for this fix. Without exclusion, implementers may over-scope or miss the kind gate.

---

### 7. Pin test environment behavior for markdownlint

Work should require the same `markdownlint-cli2` skip/dep-injection convention as sibling staged-Markdown lint tests (or equivalent), so `workflow-runner.test.ts` additions do not flake when the CLI is absent.

**Why:** Established precedent in `write-loop-staged-markdown-lint.test.ts`; unpinned tests risk environment-dependent `test:v2` failures.

---

### 8. Extend documentation updates

Add `v2/docs/prompts.md` — cross-behavior reuse of `write.staged-markdown-lint-reprompt` on the review path. Note whether prompt copy is generalized to "staged Markdown" or documented as shared across write and review.

If budget-exhaustion settlement is pinned (see §9), add `v2/docs/operator-runbook.md` for `landing_failed` + resume guidance on lint-reprompt exhaustion.

**Why:** Reusing a write-tagged prompt on review without doc update leaves operator/docs surface stale.

---

### 9. Budget-exhaustion settlement — pin or explicitly defer

Either add acceptance criteria (or decision-ledger outcome) for terminal settlement when lint-reprompt budget is exhausted — write-step parity: preserved stage, `landing_failed`, resumable — or explicitly defer to a named follow-on with rationale. Leaving it wholly implicit risks divergent operator UX given existing `resumePopulatedIntentPublication` infrastructure.

**Why:** Not the root stranding incident, but first-miss reprompt without exhaustion semantics leaves an incomplete parity story and ambiguous resume behavior.

---

### Not required

- **Subspec split:** One subspec at the execution-loop boundary remains appropriate once §1–§2 name all call sites and the retry loop; block and reprompt behavior are not independently shippable.
- **Keystone checkpoint:** Opt-in per spec guidance; guard mutation checkpoint plus two failing-test ACs suffice.
- **Second `@mutate` on retry admission:** Strengthening reprompt AC (§4) is the better hollow-pin guard if lint lives in one shared helper all paths call.