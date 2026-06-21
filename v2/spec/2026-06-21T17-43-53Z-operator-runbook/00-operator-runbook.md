# 00 - Write operator runbook

Capture recurring session friction (operator/environment discipline) in a single durable doc so future sessions don't relearn it.

## Decisions

- Land under `v1/docs/operator-runbook.md` — that's the canonical home for operator-facing docs; consistent with the docs already there.
- Link from `AGENTS.md` — the conventions index agents read on every session start.
- One flat doc, not a hierarchy — content is a short reference list, not multiple independent concerns.

## Task checklist

- [ ] Write `v1/docs/operator-runbook.md` covering all scope items from the intent
- [ ] Add a link to the runbook in `AGENTS.md` under an appropriate heading

## Acceptance criteria

- [ ] `v1/docs/operator-runbook.md` exists and covers: background-run-and-poll pattern, integration-merge-then-retest, manual-finalize recovery (last-resort path), sandbox blindness / false-negatives (ps/pgrep, auth, localhost), stable-substring pgrep matching, branch-protection + can't-self-approve + admin-merge workflow, `check:fix` vs `check:fix:unsafe` distinction, tracked-runner vs shell `&`, branch-before-edit discipline.
- [ ] `AGENTS.md` contains a link to `v1/docs/operator-runbook.md`.

## Documentation updates

- This subspec *is* the documentation deliverable; no secondary doc updates required.
