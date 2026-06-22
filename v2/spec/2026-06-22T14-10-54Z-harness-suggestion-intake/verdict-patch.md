## Verdict

**Required (blocking):**

1. **The CLI submit command must reference the template by its actual filename.** The runbook's submit instruction (`v1/docs/operator-runbook.md:46`) invokes `gh issue create --repo cbrenner04/jarvis --template harness-suggestion`, but `gh ... --template` resolves the value against the template *filename* — which is `harness-suggestion.md` — or against the frontmatter `name:` (`Harness suggestion`). The bare `harness-suggestion` matches neither, so the command resolves to no template and the off-repo observer's CLI submit path fails. This lands directly on the intent's primary user (the observer working outside the jarvis repo whose submit path is the whole point of the spec, per AC #3), and the spec's own task checklist specified `--template harness-suggestion.md` verbatim. The defect surfaces only post-merge (template resolution reads from the default branch via the GitHub API), so it won't be caught by branch-level checks — making the static correctness of the documented invocation the only safeguard. **Outcome:** the documented CLI invocation must name the template such that `gh` resolves it (i.e., the actual `.md` filename), matching the spec checklist.

**Optional (non-blocking) tightening:**

2. The one-time `gh label create harness-suggestion` prerequisite sits under the Triage section (`runbook:54`), but the template self-labels issues at *submit* time. Issues filed before the label exists arrive unlabeled. The documented manual-search fallback (`runbook:64`) already prevents silent loss and AC #4 is satisfied (the label-create precedes the only label-dependent runbook *step*, the triage filter), so this is not blocking. A one-line note that the label is created when this spec lands (or moving the prerequisite ahead of the Submit section) would close the gap. Operator's discretion.

No other findings require action.