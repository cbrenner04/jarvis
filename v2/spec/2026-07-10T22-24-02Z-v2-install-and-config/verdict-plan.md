## Verdict: Refine

The spec's core defect is real and load-bearing: it flattens three distinct execution paths — config load, model resolution, daemon lifecycle — into a single "load-time errors" bucket, and it pins two command outputs incorrectly. The intent is a *fresh-machine → configured, running daemon* walkthrough whose whole reason to exist is "document only shipped behavior"; several ACs currently pin behavior that does not match committed source, which is exactly the failure this spec must not commit.

### Required refinements

1. **Fix the `config path` output claim.** The AC pins `path` → `~/.jarvis/config.json`, but the command prints the fully-expanded absolute path (`join(homedir(), ".jarvis", "config.json")`), with no tilde substitution. Restate the AC to require the absolute expanded path; tilde is acceptable only as annotated shorthand, not as the literal output.

2. **Pin `config show` output shape.** `show` prints newline-separated agent names (one per line) or `No machine agent override configured.` — it does **not** print JSON. Only `set-agents` prints JSON. The current AC describes `show` loosely ("the machine `agents` order"), inviting a JSON-by-analogy error. Pin the line-per-agent form explicitly.

3. **Document the `machineProfile` hand-edit gap — highest priority.** No documented command (`show`/`path`/`set-agents`) writes `machineProfile`; `set-agents` writes only the `agents` array, and the others are read-only. Yet role→model resolution hard-requires `machineProfile`. So the documented command set alone cannot produce a "configured" machine. The guide must either explicitly document the required hand-edit of `~/.jarvis/config.json` to set `machineProfile`, or its promise of "configured, running" is unmet. Add an AC requiring the guide to cover this step; do not leave the CLI-only framing that silently omits it.

4. **Tie each recovery error to the command that surfaces it.** The recovery ACs must map errors to their triggering command rather than presenting one flat "load-time" bucket. Specifically: JSON-object / invalid-JSON / `agents`-validation errors surface at `config show` (config load); `machineProfile`-missing and profile-missing-`models` surface later at `jarvis run` (model resolution). An implementer reading the current flat list could wrongly document `machineProfile`-missing as a `config show` error.

5. **Add the profile-not-found error to recovery.** A typo'd profile name yields `Machine profile '<name>' not found at <path>` — a more likely first-run stumble than models-missing, and currently absent from the enumeration.

6. **Add daemon-start failure recovery.** The intent's stated destination is "start the daemon and confirm it is up," so daemon-start failures are in scope — arguably more so than run-time config errors. The recovery section covers config-load only. Add coverage for the daemon-lifecycle start errors an operator will actually hit (already-running on re-run being the most common; readiness-timeout and missing PID-file directory the others).

7. **Narrow the human-only concern to the catch-all AC.** Most "the guide says X" ACs are gradeable by inspection and follow the standard pure-doc pattern — leave them. The one AC that has no mechanical guard is the whole-document judgment "invents no config knob absent from source." Mark that single AC human-only (`(Manual)` / `no automated guard`) so it doesn't strand a run at no-progress; do not blanket-mark the rest.

### Not in scope / no action
Cross-link targets, `bin` entries, `start`/`stop`/`status` stdout+exit contracts, the two-config-layer distinction, `config/machines/` profiles, the `v2/docs/` home, and the no-`v1-behaviors.md` decision are all accurate and sound for a net-new doc.

### Rationale
Refinements 1–3 correct claims that contradict committed source — a direct violation of the spec's own "document only shipped behavior" decision and the guidance that every command/flag/path resolve to committed v2 behavior. Refinement 3 additionally closes a genuine onboarding gap: the documented flow cannot actually reach a runnable machine. Refinements 4–6 restore the intent's stated scope (recovery from the errors a *fresh, configured* operator hits, including daemon start). Refinement 7 keeps the doc spec automatable without over-marking.