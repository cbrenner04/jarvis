# 00 — Outcome matrix and operator-facing docs

## Problem

Patch and plan both rotate agents on **`kind: "quota"`** (strict from `spawn`, or lenient weak upgrade when guards allow). Operators infer intent from stderr lines (`quota exhausted`, `probable quota-like error`, `interview phase failed`, …). There is **no single authoritative table** tying: raw CLI outcome → classification → rotate? → exit code when exhausted → telemetry kind/reason.

Without that matrix, follow-up harness changes risk inconsistent UX and regressions.

## Decisions

- The matrix lives in **`docs/quota-signals.md`** as the primary reference; **`docs/run-loop.md`** and **`docs/plan-mode.md`** link to it instead of duplicating prose.
- Matrix rows must cover at minimum: **strict quota**, **lenient weak quota (guard passes)** vs **(guard fails)**, **model_config**, **timeout / SIGINT**, **generic error**, **ok**.
- Distinguish **patch iteration** (single agent per iteration until quota shift) vs **plan phase** (inner agent-order loop).

## Task checklist

- [ ] Draft the matrix (Markdown table or bullet list) with columns agreed in Problem.
- [ ] Cross-link from `docs/run-loop.md` (patch / `jarvis run`) and `docs/plan-mode.md` (plan phases).
- [ ] Note explicitly where behavior **still differs** between modes (e.g. hard `error` continuation in plan’s inner loop unless subspec 03 changes it).

## Acceptance criteria

- [x] `docs/quota-signals.md` contains the matrix (or a clearly titled subsection linked from the intro).
- [x] `docs/run-loop.md` and `docs/plan-mode.md` reference that subsection without copying the full matrix.
- [x] `bun run typecheck` passes (docs-only change still runs quickly in CI).

## Documentation updates

- [ ] `docs/quota-signals.md` (matrix).
- [ ] `docs/run-loop.md` (link + short pointer paragraph).
- [ ] `docs/plan-mode.md` (link + short pointer paragraph).
