## Verdict

The spec's shape is sound — single subspec, GitHub-issue-template channel, zero-new-infra, runbook-as-doc-home all hold. But its core mechanism (`gh` issue-template behavior) is asserted, never verified, and that defect undercuts the intent's primary user. The following refinements are required.

**1. Make the headline AC verifiable before merge.**
`gh issue create --template` resolves templates from the repo's default branch via the GitHub API, not the local working tree — so on this pre-merge branch the command cannot succeed, and an AC that grades it violates the repo rule to verify before ticking. Restate the contract as conditions observable on the branch: the template file exists at the documented path with well-formed frontmatter and the three required prompts (friction/gap observed; target repo + Jarvis command in play; suggested change). Any "`gh` opens a pre-filled issue" expectation belongs as a post-merge note, not a tick-before-merge criterion.

**2. Pin or harden the label mechanism, and order the label-create step.**
The triage path (`gh issue list --label harness-suggestion`) is entirely dependent on the template's `labels:` frontmatter actually applying the label — an unverified assumption. The spec must either confirm and pin that behavior, or make the triage filter robust to label-absence (documented fallback to find suggestions another way). Either way, the one-time `gh label create harness-suggestion` must be sequenced as an explicit prerequisite of the label-bearing path, not a loose trailing note — a label-applying template referencing a nonexistent label is the failure case to rule out.

**3. Make the submit path actually work from the other-repo context — this is the intent's core.**
The whole point is an observer working *outside* the jarvis repo. `gh issue create` and `--template` default to the current (target) repo, so the documented instructions silently target the wrong repo and won't find jarvis's template. The submit instructions must give an explicit cross-repo invocation — `--repo <owner/jarvis>` (with the jarvis slug pinned) or the web template-chooser URL — so the off-repo observer reaches the jarvis template with no jarvis checkout. Without this the spec does not satisfy its intent.

**4. Add chooser frontmatter to the template-content contract.**
The intent contemplates web submission; a classic markdown template needs `name`/`about` frontmatter to appear in the web chooser. Fold these into the template-content AC alongside the well-formed-frontmatter requirement from #1.

**5. Resolve the dual-audience tension in the runbook section.**
The runbook already cross-references this section for the other-repo observer, so the discoverability path largely exists and no new onboarding doc is needed. But the doc's framing disclaims the other-repo observer as its audience while housing their actionable submit steps. Make the section openly dual-audience in its opening so a reader just told "not for you" knows the submit steps are theirs.

**6. Permit a no-seed close in triage (minor).**
The triage path frames every issue as a 1:1 wip-intent conversion. Since the intent keeps triage as human judgment, allow the operator to close a suggestion without seeding a wip-intent when it isn't worth one. One sentence; low priority.

Items 1–3 are blocking: they share one root cause — unverified `gh --template` assumptions — and #3 directly determines whether the spec serves the user it exists for. Items 4–6 are cheap refinements within the existing single subspec; no split is warranted.