## Verdict — refinements required

**1. Fix the false premise about prose-phrased keystones (intent.md and subspec Problem).**
Keystone selection requires the canonical `` `pinFile` — `pinTitle`; Keystone checkpoint:`` suffix; a prose-only checkpoint is selected by nothing, produces no unlinked finding at all, and is now rejected at plan-draft. The reproducer this spec must describe is a *canonically suffixed* keystone naming a pin — greenfield or not — that the plan left without an authored `// @mutate` directive. Leaving the prose clause in points the implementer at a fixture that cannot exist and repeats a premise error already corrected once on this seam.

**2. Decide what happens when the named pin carries a malformed directive.**
A directive with a bad body on the correct pin yields *both* a blocking unparseable entry and an unlinked keystone — the most likely real agent mistake — and the spec's "only blocking finding" admission rule silently keeps it terminal. Either admit malformed-in-the-named-pin as reprompt-eligible alongside unlinked, or record the terminal outcome as a deliberate deferral with rationale. Silence here misstates the spec's coverage.

**3. State prompt precedence and reprompt-context lifecycle.**
Prompt selection short-circuits on a pending mutation-directive reprompt, so the spec must decide which context wins when both are pending, and must state that the keystone context clears on the same terminal condition as the existing one. This is behavior, not layout latitude.

**4. Name the criterion and resolved pin path in the exhaustion blocker.**
The spec already puts the pin path on the report entry; the settle message currently identifies neither criterion nor path, which makes the runbook recovery section the intent requires point at an unactionable blocker.

**5. Decide the report-entry shape.**
Whether the unlinked-keystone entry widens the shared checkpoint type or forks a keystone-specific one is a one-line decision with consumer blast radius. State it.

**6. Pin the resume behavior to a named test.**
The resume acceptance criterion asserts restore-from-log with no test title and no daemon-side pin, while the task checklist promises daemon plumbing. Per the repo's failing-test rule, name the test(s) that cover both write-loop input recovery and the daemon path.

**7. Add an acceptance criterion for prompt-registry registration.**
The checklist requires registering `write.keystone-directive-reprompt` in the registry; no criterion grades it.

**8. Record explicit deferrals for adjacent gaps the spec does not close.**
- Guard (`Mutation checkpoint:`) criteria with an unlinked directive still hard-block, and a mixed guard+keystone miss still strands — deliberate sibling deferral, not an oversight.
- Exhaustion after `maxIterations` still settles into the same non-resumable strand the intent names as the headline damage; the spec narrows but does not remove it. Say so.
- The double verification pass and missing per-iteration wall budget on this path are inherited from the existing mutation-directive reprompt, not introduced here — one-line acknowledgment.

**9. Fix the contradictory Behavior sentence.**
"A keystone ticked with no directive anywhere in the enclosing test still fails the contract with the unlinked blocker" is only true after budget exhaustion; as written it describes the exact behavior this spec changes. Correct in both intent and subspec.

**10. Decide singular-vs-plural shape deliberately.**
More than one keystone refuses earlier with a distinct blocker, so at most one unlinked keystone can reach the reprompt. Fix the prompt/event payload as singular by decision rather than by accident.

**11. Note the self-reference hazard.**
Completion runs against the installed daemon, so this spec's own implement run gets no benefit from the fix it lands. A Decisions line prevents the run being lost to its own blocker.

## Rejected

- **Splitting the docs criterion into five checkboxes.** The Documentation updates section already enumerates the files and required content; five checkboxes grade nothing differently.
- **Splitting the subspec.** Verifier, completion contract, write loop, prompt artifact, and resume plumbing are one execution seam and one observable behavior; the resume restore is not independently testable before the event it replays exists. Precedent on the mutation-directive reprompt spans exactly this set in one subspec. Keep it whole.