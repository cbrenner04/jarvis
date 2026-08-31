Verifying the advocate's key claims against the codebase before issuing the verdict.
## Verdict — required outcomes

1. **Intent split must read agent-core sizing guidance, not the operator monolith.** `prompts/intent/split.md` still tells the split agent to read `v1/docs/spec-guidance.md` for sizing and reviewability. After subspec 01 that file is operator-only; those rules live in `v2/docs/spec-guidance-agent-core.md`. Intent split has no `SPEC_GUIDANCE` injection, so this prompt step is the harness path for that guidance. Leaving it on the operator doc is a functional regression against the split’s purpose.

2. **Durable docs must not claim intent split injects `SPEC_GUIDANCE`.** `v2/docs/prompts.md`, `v2/docs/v1-behaviors.md`, and `v2/docs/workflow-runner.md` state that intent split receives install-root `SPEC_GUIDANCE` from the agent core. Runtime wiring injects agent core only on plan draft/review and intent **review** (`shared/prompts/review-intent.ts`); `intent.prompt.split` has no `SPEC_GUIDANCE` placeholder. Subspec 02 required accurate injection-source documentation; these overclaims fail that bar.

3. **Split-boundary prose must be coherent on both sides.** Agent core line 24 ends mid-thought at `` `ready-intents/`; `` with no completion. Operator doc line 119 is the consumption sentence without the fan-out context it depends on. The inventory assigns the split correctly, but the landed text is not readable standalone. Both documents must present their partition faithfully **and** read as complete prose.

4. **Lossless-partition verification must be explicitly closed.** Subspec 01 leaves unchecked: every former monolith section appears in exactly one on-disk document and matches the split inventory. Index and other 01 ACs are ticked without closing this one. Confirm against `20260831T095540Z-split-spec-guidance-documents/00-lossless-split-spec-guidance.md` and record the result (tick the AC or append a `## Blocker` with the mismatch). Do not leave the routing artifact ambiguous.

5. **Add a regression guard for the intent-split guidance pointer.** A test (e.g. in `shared/prompts/intent-split.test.ts`) must fail if `prompts/intent/split.md` again references `v1/docs/spec-guidance.md` for sizing/reviewability instead of the agent core. Outcome 1 needs a pin so the regression cannot recur silently.

## Rationale

Subspecs 00–02 delivered correct `SPEC_GUIDANCE` wiring at enumerated producers and aligned most durable docs. Remaining gaps are outside that producer list but inside the spec’s behavioral intent: agents doing intent split still receive wrong guidance; subspec 02 docs overstate runtime behavior; partition cleanup debt from subspec 01 was deferred and never verified. Outcomes 1–3 restore correct agent behavior and doc truth. Outcomes 4–5 close verification and prevent recurrence.

## Not required

- Operator-exclusion pins on every producer render (subspec 00 scoped plan-draft extraction plus bundled-guidance retention tests).
- `@mutate` that fails only exclusion while retention passes (pre-split monolith no longer exists at the operator path).
- `AGENTS.md` pointer churn (subspec 02 explicitly preserved operator entry at `v1/docs/spec-guidance.md`).
- `shared/spec-guidance-path.ts` resolving under `v2/docs/` (decision-ledger intent).
- Empty `SPEC_GUIDANCE` in rendered-snapshot tests (content depth covered elsewhere).