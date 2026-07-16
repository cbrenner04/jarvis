# 00 - Publisher confirms PR evidence or fails

`findOrCreatePr` in `v2/src/execution/completion-publisher.ts` trusts unconfirmed
output. It scans `gh pr create` stdout with `/(?:pull\/|#)?(\d+)/` and returns the
first digit run anywhere in it — an owner or repo slug containing digits
(`github.com/cbrenner04/jarvis/pull/1655`) yields `4`, and a `gh` notice line
yields whatever number it mentions. The lookup branch returns a listed number
without confirming the PR still exists. Either way the publisher reports a PR
number that no PR has, and the run publishes with no real evidence.

Reproduce before fixing: drive the publisher against a `gh` seam whose create
output is a realistic PR URL under a digit-bearing owner, and assert the
pre-fix number is wrong.

## Decisions

- Confirm the PR by querying `gh` for the branch's open PR (number, url, baseRefName) rather than parsing create stdout; rules out treating create output as evidence, which is what makes a wrong or absent number look like success.
- Confirm after both the found and the created path; rules out trusting the pre-create list, whose rows may be stale or base-mismatched.
- Return the confirmed number and URL together as the publisher's PR evidence; rules out returning a bare number and forcing later callers back to a live `gh` query for the URL.
- Raise the missing-evidence failure through the existing `pr` publication operation so it normalizes like other command causes; rules out a bespoke error path that loses the exit code and output tails.
- Missing evidence is not transient: it makes one attempt; rules out burning retries on a lookup that already answered.

## Acceptance criteria

- [ ] A publisher test whose `gh pr create` seam returns a PR URL under a digit-bearing owner asserts the publisher reports the PR's real number and URL; it fails against the pre-fix code, which reports a number parsed out of the owner slug.
- [ ] A publisher test whose post-create confirmation returns no open PR for the branch, and one whose confirmed PR has a different base than the requested `baseRef`, each fail publication with a named `pr` publication failure carrying the command cause rather than returning a PR number.
- [ ] Publication succeeds only when the confirmed PR matches the requested branch and base; the confirmed number and URL are both available on the publisher result.
- [ ] `completion-publisher.test.ts` push, retry, body-refresh, and title-resolution tests stay green (confirmation is additive to those paths).
- [ ] Missing PR evidence makes one confirmation attempt (no transient retry).

## Documentation updates

- `v2/docs/write-behavior.md` — completion publication evidence contract: PR confirmed by lookup (number + URL, matching branch and base), missing evidence is a named `pr` publication failure.
