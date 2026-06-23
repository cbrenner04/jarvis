## Verdict

Uphold the following; refine the spec accordingly.

**1. Name every output site of the summary path (highest-value fix).**
The placement decision frames coverage as a binary "telemetry vs no-telemetry" split, but the actual code has three distinct return sites that emit summary text: the shared render function's zero-records early return, that function's final return, and the two function-level early returns when no telemetry path exists. The binary framing leaves the zero-records render uncovered, which directly breaks AC #1/#2 ("summary ends with a line containing the URL") in the empty-records case. The spec must reframe the placement decision so the nudge is guaranteed on **every** summary emission, and must add an acceptance criterion (and matching task) covering the zero-records render. This is the core defect; do not leave it as a paraphrased "both branches" claim.

**2. Correct the "fires once" rationale.**
The decision attributes once-per-invocation behavior to the summary "gating on real attempts." It does not — the summary renders unconditionally; the once-per-invocation guarantee comes from the call sites that gate on whether any agent/telemetry writes occurred. Relocate the rationale to the call-site gate. Design is unchanged; only the stated reason is wrong, and a wrong rationale invites a future change that removes the real gate.

**3. Fix AC #6: make the doc-equality claim verifiable and complete.**
AC #6 (constant value equals the hardcoded URL in the docs) has no backing task or test and is unfalsifiable as written. The spec must either add a check that asserts equality or explicitly designate it a manual-review criterion with a corresponding checklist item. Additionally, the doc set is incomplete — there are **four** prose copies of the URL (README, AGENTS, CLAUDE.md, operator-runbook), and the spec lists only three. Add the missing copy to the equality set.

**4. Correct the "rules out a fourth hardcode" framing.**
Four prose copies of the URL already exist. The new constant is not a deduplication — it is a fifth, code-side home that the prose copies must stay in sync with. Restate the decision as "introduces the single code-side constant and keeps prose copies in sync," not "prevents a fourth copy."

**5. Clarify the no-telemetry AC as a unit-test invariant.**
Because both call sites gate on writes, the no-telemetry path is not operator-reachable via the CLI; it is exercised only by direct unit tests of the exported functions. State that the nudge-on-no-telemetry expectation is a unit-test invariant on the pure function, not an operator-visible path, so the AC isn't read as promising operator-visible behavior.

**6. Clarify the prompt-mode negative AC.**
AC #5 (prompt emits no nudge) is a legitimate scope guard pinning the deferral, but is satisfied by construction since prompt has no summary surface. Add a clause stating it is verified by the absence of any nudge on prompt exit paths, so the criterion is checkable rather than vacuous.

**7. Pin nudge placement/format (cheap).**
"Ends with a single line" leaves ordering and separation unspecified while a `notes:` block is already last. Specify the nudge's position relative to existing trailing output and that it is a distinct line, to remove implementer guessing.

**Keep as-is:** the help-output negative AC (cheap regression guard consistent with the intent's "no help-footer noise" constraint — the constant introduces the first importable URL in code, which is exactly what it guards), and the unspecified constant home (legitimate implementer latitude for a harness subspec; a one-line "must be importable by run-summary.ts" note is optional, not required).

Rationale: the intent requires the URL to appear **once** on each completed run/plan summary, sourced from a single shared constant kept in sync with the prose copies. The branch taxonomy gap (#1) and the unverifiable/incomplete doc-equality AC (#3) are the two refinements without which the spec can pass review while shipping behavior that fails its own acceptance criteria; the rest are correctness-of-rationale and checkability clarifications that keep the spec honest per the behavioral-AC and verification standards in spec guidance.