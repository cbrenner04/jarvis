# 00 - Write operator runbook

Capture recurring session friction (operator/environment discipline) in a single durable doc so future sessions don't relearn it.

## Decisions

- Land under `v1/docs/operator-runbook.md` — that's the canonical home for operator-facing docs; consistent with the docs already there.
- Link from `AGENTS.md` only — `v1/docs/` has no separate docs index, so `AGENTS.md` is the sole link target; covers the intent's "docs index / `AGENTS.md`" requirement.
- One flat doc, not a hierarchy — content is a short reference list, not multiple independent concerns.
- Cross-reference automated paths by behavior name, not by `v2/spec/wip-intents/` paths — intent paths are unstable pre-merge artifacts; a permanent `v1/docs/` file must link to durable behavior names (or landed doc paths) so links don't rot.
- Technical claims (`check:fix` vs `check:fix:unsafe` distinction, admin-merge skips completion gate) verified against `package.json` / `scripts/ready.ts` before writing — not transcribed from the session report verbatim; the `noImplicitAny`/`noExplicitAny` grouping in the source report is incorrect (`noImplicitAny` is a TS compiler flag, not a Biome auto-fix target) and must be corrected.

## Task checklist

- [x] Verify `check:fix` vs `check:fix:unsafe` claims and admin-merge/lint-gate claim against `package.json` and `scripts/ready.ts`; correct the `noImplicitAny` conflation
- [x] Write `v1/docs/operator-runbook.md` covering all scope items; manual-finalize section names the automated-path behaviors it supersedes
- [x] Add a link to the runbook in `AGENTS.md` under an appropriate heading

## Acceptance criteria

- [x] `v1/docs/operator-runbook.md` exists and covers: background-run-and-poll pattern, integration-merge-then-retest, manual-finalize recovery (last-resort path), sandbox blindness / false-negatives (ps/pgrep, auth, localhost), stable-substring pgrep matching, branch-protection + can't-self-approve + admin-merge workflow, `check:fix` vs `check:fix:unsafe` distinction, tracked-runner vs shell `&`, branch-before-edit discipline.
- [x] The manual-finalize / last-resort section in the runbook names the automated-path behaviors (completion gate, lint convergence, flaky-test retry) it is a fallback for — not a bare path to unmerged spec files.
- [x] The `check:fix` vs `check:fix:unsafe` distinction in the runbook is accurate per `package.json` / `scripts/ready.ts`; `noImplicitAny` is not listed as a Biome auto-fix item.
- [x] `AGENTS.md` contains a link to `v1/docs/operator-runbook.md`.

## Documentation updates

- This subspec *is* the documentation deliverable; no secondary doc updates required.
