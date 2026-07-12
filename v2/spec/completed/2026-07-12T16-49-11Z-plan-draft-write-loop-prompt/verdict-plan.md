The findings hold up on inspection — v2's current path renders the artifact body only, with no fragment assembly, no delimiter enforcement, and an already-absolute `targetDir`. Verdict below.

## Verdict — refinements required

**1. `01` must decide and grade fragment assembly.**
Routing v2 through the shared builder changes more than "append two suffixes": today `executePlanDraftWrite` renders the `plan.prompt.draft` artifact body alone, while the shared-builder path (like `intent.prompt.split`) assembles the global + plan behavior fragments ahead of the artifact. That is the correct outcome — v2's body-only render is a second instance of the same bug — but the spec currently hides it. Add a decision naming the change (v2 adopts full fragment assembly, matching v1 and intent-split; rules out preserving the body-only render) and an acceptance criterion that the rendered plan-draft prompt carries the plan behavior fragments, not just the artifact body.

**2. `00`/`01` must pin the new delimiter-violation failure path.**
The shared builder enforces delimiter policy on `INTENT`/`SPEC_GUIDANCE` and throws; v2's current path does not, so this introduces a new throw inside `executePlanDraftWrite`. Say what that throw becomes in the v2 write loop (classification, and that it is not an unhandled crash), and pin it with an acceptance criterion. v1's conversion of the same throw into a `model_config` result must be stated as preserved.

**3. `00` must pin the builder's error message/type contract.**
v1 currently throws `draft prompt configuration error: …`; the shared render path throws a different error type with a different message. "Byte-identical v1 output" covers prompts, not failures. Record the error contract as a decision so the extraction cannot silently drift v1's failure semantics (no existing test pins the message, which makes the decision more necessary, not less).

**4. `01`'s spec-dir acceptance criterion currently grades nothing — pin one concrete path form.**
`specPath` is already worktree-resolved and absolute by the time `executePlanDraftWrite` runs, so the rewrite emits an absolute `<worktree>/…/<targetDir>/<NAME>/`. An AC saying the prompt "still targets `<targetDir>/<NAME>/`" passes under either the relative or absolute form and cannot detect a regression. Decide which value the prompt names — it should be the same value the file-output target and the completion validator use — and write the AC against that.

**5. `01` needs one end-to-end guard, not only prompt-substring assertions.**
Every current `01` criterion asserts a substring in the rendered prompt; a fully green substring suite is compatible with the loop still failing exactly as the intent describes. Add a criterion exercising the plan-draft write step through the write loop with a stubbed agent that writes the spec files into the resolved spec directory and terminates with the done token, so the file-output target, terminal-token contract, and the existing contract checks are pinned together. (Do not write an AC asserting that a real agent obeys the prompt — that is not harness-gradeable.)

**6. `01`'s `stepRules` decision and AC overstate what is wired.**
The plan workflow's write step supplies `DEFAULT_WRITE_STEP_RULES`; the daemon's revise-append mechanism only targets a human step's repeat target, and the plan source step emits no human step — so "a revise-appended rule reaches the agent" cannot be exercised on the plan path. Reduce both the decision and the criterion to the true, testable claim: the step's `stepRules` string is passed through verbatim into the step-completion section.

**7. `00` must cite the flat-layout test rather than paraphrase it.**
The criterion "`flatSpecLayout` and `targetDir` rewrites match v1's current behavior" is a behavior-preservation claim written as prose. Per the refactor-AC rule in spec guidance, cite the existing pinning test (`v1/test/modes/plan/spec-dir.test.ts`, which covers `buildDraftPrompt` flat layout) in the stays-green list.

**8. `01` needs an explicit out-of-scope line for per-iteration `intent.md` rewriting.**
`executePlanDraftWrite` rewrites `intent.md` from the seed on every write-loop iteration. Today the step dies on iteration 1 so it never bites; once this fix lets iterations proceed, an agent-appended blocker is erased from disk by the next iteration. The fix is a distinct behavior change with its own contract implications and should not be folded into `01` — but the spec must name it as seen-and-deferred so a reader does not read the omission as an oversight.

**9. `00` should state the `<NAME>` decision.**
v1 passes the plan name, v2 passes the timestamped directory basename; the builder is caller-agnostic. Because `<NAME>` appears in prompt text the agent reads, make the agnosticism a stated decision rather than an accident.

**Sizing:** the 00/01 split is sound; both remain independently implementable and reviewable. `01` should absorb the added work above rather than split further.