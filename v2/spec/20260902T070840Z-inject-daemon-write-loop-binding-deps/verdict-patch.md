Verifying the disputed `run list` log-tail behavior change and admission-handler injection gap before issuing a verdict.
## Verdict

**Required: revert the accidental `run list` resume-context change.**

`buildRunListRow` now passes `logTail` into `resumeContextForTerminalRecord`, which feeds `reconstructWriteResume` and can surface landing-contract, markdown-lint, and surviving-mutation reprompts on the list path. On main, `run list` called `resumeContextForTerminalRecord` without log records; only `handleResume` passed them. That is an operator-visible semantic change unrelated to binding-source injection and conflicts with the subspec’s “no operator-facing behavior change.” Restore list-path behavior: do not pass log records into resume reconstruction on `run list`.

**No other actuator changes.**

- **Admission-handler `productionAgentBindingFactory()` gap:** Pre-branch production also used empty deps on that path; the subspec scoped injection to `daemon.ts` handler/startup seams and listed tests. Not a regression against acceptance criteria; follow-up only if “every factory consumer honors injection” becomes a separate requirement.

- **Ceiling via `jarvisHome()`:** Known limitation; tracked in ready-intent `daemon-resume-honors-injected-config-path.md`. Outside this subspec.

- **`intent.md` / vacuous `cli.ts` criterion:** Doc hygiene only; subspec acceptance is satisfied.

- **Closure relocation, test mutable fixtures, exported override fields:** Mechanism and test patterns are within spec; no production-global regression.