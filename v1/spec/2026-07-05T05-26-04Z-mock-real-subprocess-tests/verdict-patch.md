## Verdict

Three required fixes, in priority order:

**1. `shrink.ts` must actually route its injected git ops into `detectSpecTreeEdits`/`revertSpecTreeEdits`.**
Those functions accept an optional `ReviewGitOps` seam (defaulting to real git), but `shrink.ts` never passes its own `ShrinkGitOps` through — it always falls through to the real-git default regardless of what a test injects. Since `ShrinkGitOps` already covers every operation these functions call (`porcelainStatus`, `checkoutPath`, `cleanPath`) minus `resetPath`, a thin adapter closing that gap is required so shrink tests can genuinely govern this code path via injection, per the spec's boundary-extension decision ("subspecs may extend the boundary to production git/gh call sites under test"). The inline test comment claiming "no injectable seam" is inaccurate and must be corrected (or removed) once the adapter is wired.

**2. Cross-process `fs.watch` coverage in the v2 `ipc`/`log-stream` conversions needs an explicit resolution.**
The in-process wake-seam replacement is legitimate for replay/abort/wake logic, but it does not exercise the one thing only a real OS-level test proves: that file-change notifications actually cross a process boundary (a separate process writing while another watches), which the deleted real-subprocess tests did cover. This must be resolved one of two ways: restore one narrow real-subprocess test per affected file with inline justification per `v2/docs/test-writing.md`, or add an explicit note (in the subspec or test file) recording the judgment that in-process wake-seam coverage is deemed sufficient and why. Silent removal of the assertion is not acceptable per the spec's own "may stay with justification" language.

**3. Restore the unrelated `jarvis1 plan` type-union merge-conflict tip removed from `v1/docs/operator-runbook.md`.**
This paragraph documents operational knowledge unrelated to subprocess-test flakiness and falls outside subspec 20's scope (which only authorizes dropping/narrowing the three named gotchas: `ci-shrink-test-hang`, `triage-merge-classify-load-flake`, `v2-test-runner-unbounded-spawn`). It must be put back to avoid losing still-applicable operator guidance as an unauthorized side effect of this spec.

No action needed on the agent-spawn "weakened assertion" claim (unsubstantiated — the mocked test preserves the same assertions as the prior version) or on the Task Checklist/Documentation-updates checkbox state in subspec 20 (expected per repo convention: only Acceptance Criteria are jarvis-owned).