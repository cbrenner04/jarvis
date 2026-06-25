# run: human-only acceptance criteria open a reviewable draft PR instead of blocking

Human-only acceptance criteria (`(Manual)`, "visual inspection only", "no automated guard") should let a run finish the normal draft-PR path for a human to verify, instead of blocking at exit 7 with no PR.

- [ ] [00 - Complete the draft-PR path when only human-only criteria remain](./00-complete-on-human-only-remaining.md)
- [ ] [01 - Patch rules: treat human-only criteria as operator-verified](./01-patch-rules-human-only-operator-verified.md)
- [ ] [02 - Surface unchecked human-only criteria on the PR](./02-pr-human-verify-checklist.md)

Ordering: subspec 00 defines the `humanOnly` classification on the parsed criterion; subspec 02 (PR-body work) consumes it and cannot land before 00.
