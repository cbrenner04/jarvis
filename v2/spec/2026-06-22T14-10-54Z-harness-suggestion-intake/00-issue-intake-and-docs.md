# GitHub issue intake + triage/submit docs

## Problem

Observers driving Jarvis on a non-Jarvis target repo surface harness gaps but can't write wip-intents (those require the jarvis repo). They need a channel to feed suggestions back; the Jarvis-on-Jarvis observer then triages each into a wip-intent. The runbook's `## Harness suggestions from other repos` section currently only points at "the intake channel" without defining one.

## Decisions

- Channel = a GitHub issue template on the jarvis repo. Rules out a file/dir inbox and a `jarvis suggest` subcommand — intent prefers lightest/zero-new-infra; observers already have `gh`/web.
- Template format = classic markdown at `.github/ISSUE_TEMPLATE/harness-suggestion.md`. Rules out a `.yml` issue form — markdown needs no form/validation infra and works with the web chooser for a single operator.
- Pin the jarvis slug as `cbrenner04/jarvis` in submit docs. Rules out bare `gh issue create`, which defaults to the observer's current (target) repo and never reaches the jarvis template.
- `gh label create harness-suggestion` is a one-time prerequisite, sequenced **before** the label-bearing template is relied on. Rules out a template `labels:` referencing a nonexistent label (label silently absent, breaking triage's filter).
- Triage filters by `--label harness-suggestion` with a documented fallback (search the open-issue list) for label-absence. Rules out a triage path that breaks silently if the label didn't apply.
- Triage and submit instructions both live in the existing runbook `## Harness suggestions from other repos` section, made openly dual-audience. Rules out a new onboarding doc — there is no other-repo-observer onboarding home, and the runbook already owns this cross-repo loop.

## Task checklist

- [ ] Add `.github/ISSUE_TEMPLATE/harness-suggestion.md` with frontmatter (`name`, `about`, `labels: harness-suggestion`) so it appears in the web chooser and self-labels, plus body prompts for: the friction/gap observed; the target repo + Jarvis command in play; the suggested harness change.
- [ ] In the runbook section, document the submit path with an explicit cross-repo invocation (`gh issue create --repo cbrenner04/jarvis --template harness-suggestion.md`, or the web new-issue chooser URL) — no jarvis checkout required.
- [ ] Document the triage path: `gh issue list --repo cbrenner04/jarvis --label harness-suggestion` (with a label-absent fallback), convert each into a `v2/spec/wip-intents/` intent, close the issue referencing the seeded intent; allow closing without seeding when a suggestion isn't worth an intent.
- [ ] Sequence the one-time `gh label create harness-suggestion --repo cbrenner04/jarvis` as a prerequisite of the label-bearing path.
- [ ] Make the section opening dual-audience so an other-repo observer (disclaimed as the doc's primary audience at the top of the runbook) knows the submit steps are theirs.

## Acceptance criteria

- [ ] `.github/ISSUE_TEMPLATE/harness-suggestion.md` exists with well-formed frontmatter carrying `name`, `about`, and `labels: harness-suggestion`.
- [ ] The template body prompts for all three: the observed friction/gap, the target repo and Jarvis command involved, and the suggested change.
- [ ] `v1/docs/operator-runbook.md` `## Harness suggestions from other repos` gives the other-repo observer an explicit cross-repo submit invocation targeting `cbrenner04/jarvis` (via `gh ... --repo cbrenner04/jarvis --template` or the web chooser URL) that needs no jarvis-repo checkout.
- [ ] The same section tells the Jarvis-on-Jarvis observer to list suggestions via `gh issue list --repo cbrenner04/jarvis --label harness-suggestion` with a documented fallback for when the label is absent, convert each into a `v2/spec/wip-intents/` intent, and close the issue referencing the seeded intent — and permits closing without seeding when a suggestion isn't worth one.
- [ ] The section sequences `gh label create harness-suggestion --repo cbrenner04/jarvis` as a one-time prerequisite ahead of the label-dependent steps.
- [ ] The section's opening reads as dual-audience: a reader told elsewhere they aren't the runbook's primary audience can tell the submit steps are addressed to them.

## Post-merge note

`gh issue create --template` and the web chooser resolve the template from the repo default branch via the GitHub API, so the pre-filled-issue behavior is only observable after this spec merges to `main` — verify there, not on the spec branch.

## Documentation updates

- `.github/ISSUE_TEMPLATE/harness-suggestion.md` — the intake channel itself (self-documenting submission).
- `v1/docs/operator-runbook.md` — flesh out `## Harness suggestions from other repos` with submit + triage paths, label prerequisite, and dual-audience framing.
- No `v2/docs/v1-behaviors.md` update: no v1 runtime behavior changes (docs + GitHub template only).
