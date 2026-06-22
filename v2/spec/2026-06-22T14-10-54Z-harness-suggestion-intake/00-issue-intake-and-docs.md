# GitHub issue intake + triage/submit docs

## Problem

Observers driving Jarvis on a non-Jarvis target repo surface harness gaps but can't write wip-intents (those require the jarvis repo). They need a channel to feed suggestions back; the Jarvis-on-Jarvis observer then triages each into a wip-intent. The runbook's `## Harness suggestions from other repos` section currently only points at "the intake channel" without defining one.

## Decisions

- Channel = a GitHub issue template on the jarvis repo. Rules out a file/dir inbox and a `jarvis suggest` subcommand — intent prefers lightest/zero-new-infra; observers already have `gh`/web.
- Template format = classic markdown at `.github/ISSUE_TEMPLATE/harness-suggestion.md`. Rules out a `.yml` issue form — markdown needs no form/validation infra and works with `gh issue create --template` for a single operator.
- Apply label `harness-suggestion` via the template's frontmatter so triage lists by label. Rules out relying on a title-string convention to find suggestions. The label is created once with `gh label create`; document that.
- Triage and submit instructions both live in the existing runbook `## Harness suggestions from other repos` section. Rules out a new onboarding doc — there is no other-repo-observer onboarding home, and the runbook already owns this cross-repo loop.

## Task checklist

- [ ] Add `.github/ISSUE_TEMPLATE/harness-suggestion.md` with `harness-suggestion` label frontmatter and prompts for: the friction/gap observed, the target repo + Jarvis command in play, and the suggested harness change.
- [ ] Expand the runbook `## Harness suggestions from other repos` section with the submit path (other-repo observer) and the triage path (Jarvis-on-Jarvis observer).
- [ ] Note the one-time `gh label create harness-suggestion` step.

## Acceptance criteria

- [ ] `.github/ISSUE_TEMPLATE/harness-suggestion.md` exists; `gh issue create --template harness-suggestion.md` opens an issue pre-filled with the template body and the `harness-suggestion` label.
- [ ] The template body prompts for the observed friction/gap, the target repo and Jarvis command involved, and the suggested change.
- [ ] `v1/docs/operator-runbook.md` `## Harness suggestions from other repos` tells an other-repo observer how to submit (open a `harness-suggestion` issue via `gh` or web), with no jarvis-repo checkout required.
- [ ] The same section tells the Jarvis-on-Jarvis observer how to triage: list open `harness-suggestion` issues (e.g. `gh issue list --label harness-suggestion`), convert each into a `v2/spec/wip-intents/` intent, and close the issue referencing the seeded intent.
- [ ] The section documents the one-time `gh label create harness-suggestion` setup.

## Documentation updates

- `.github/ISSUE_TEMPLATE/harness-suggestion.md` — the intake channel itself (self-documenting submission).
- `v1/docs/operator-runbook.md` — flesh out `## Harness suggestions from other repos` with submit + triage paths.
- No `v2/docs/v1-behaviors.md` update: no v1 runtime behavior changes (docs + GitHub template only).
