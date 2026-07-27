# Adjudicator verdict — pipeline `intent` + `debate` posture realization

## Upheld issues

The core intent (admit and resolve `intent` + `debate` via bare `intent` with `reviewPasses: 1` and `reviewBehavior: "debate"`; keep `intent` + `light` and `implement` + `none` bounds) is sound. These gaps would mislead implementers, leave docs inconsistent, or weaken verification:

1. **Resolution contract is ambiguous** — `intent.md` says built steps “carry `reviewBehavior`,” while the subspec correctly targets **builder input**. Without alignment, an agent can pass tests on the wrong object while production still defaults to light review (`reviewBehavior ?? "light"`).

2. **End-to-end debate review is under-specified** — Invert-guard and fake-builder resolution tests can pass without proving debate review actually runs. The spec should require observable debate review on the **real preset builder path** (e.g. a `review-debate` step), symmetric to existing real-builder coverage for `intent` + `none`.

3. **Documentation scope is too narrow** — `daemon-host.md` has a pipeline posture table that will disagree with `workflow-runner.md` if only one file is updated. `workflow-runner.md` also has dependent prose (e.g. unrealizable cell count, preset-alias rationale) that becomes wrong when only the table cell changes.

4. **Table notation needs an explicit decision** — Light stays on `intent-reviewed`; debate uses bare `intent` plus behavior. Doc tasks should state that mixed notation in tables is intentional for this slice, not an incomplete refactor.

5. **Subspec hygiene vs spec guidance** — Prerequisites live only on `intent.md`; implementers read the subspec. The `implement` + `none` preservation AC should **cite the existing test name** instead of paraphrasing. The admission AC should require **renaming** the inverted debate test so the title matches new behavior.

6. **Invert-guard acceptance criterion** — Standalone invert-guard bullets duplicate guidance without naming tests; fold into the failing-test ACs for admission and resolution or tie them to those test names.

7. **`v1-behaviors.md`** — Repo guidance expects behavior-change catalog updates. There is no stale pipeline bullet today, but the spec should either add a minimal `[v2 behavior change]` entry with sources or explicitly record why this slice is exempt (prefer the catalog line for a real admission/resolution change).

## Required refinements (outcomes)

| # | Outcome |
|---|--------|
| **R1** | **Single resolution contract** across `intent.md` and the subspec: debate resolution is verified via builder input (`reviewBehavior: "debate"`, `reviewPasses: 1`) **and** operator-visible debate review on the real builder path (e.g. at least one step with debate review behavior). Tasks and ACs must not imply only a `reviewBehavior` field on step objects. |
| **R2** | **Documentation updates** must include **`v2/docs/daemon-host.md`** in lockstep with **`v2/docs/workflow-runner.md`**: `intent` + `debate` realizable, sole unrealizable cell `implement` + `none`, and consistent posture→preset/review derivation. AC must require both docs aligned, not only `workflow-runner.md`. |
| **R3** | **Doc AC/task** must cover **stale dependent prose** in `workflow-runner.md` (unrealizable count, preset-alias explanations, error/rationale bullets tied to the old two-cell model), not only the matrix cell. |
| **R4** | **Decisions** must state how pipeline tables document **light** (`intent-reviewed` path unchanged) vs **debate** (bare `intent` + `reviewPasses` / `reviewBehavior`) so mixed notation is deliberate. |
| **R5** | Subspec **`## Prerequisites`**: copy the two prerequisites from `intent.md` so the implement gate is on the active file. |
| **R6** | **Preservation AC** for `implement` + `none`: cite **`"implement under none is unrealizable; light on the same stage validates clean"`** stays green (refactor AC pattern). |
| **R7** | **Admission AC**: require **renaming** the replaced debate admission test when behavior inverts; do not only require new assertions under the old title. |
| **R8** | **Remove or merge** the standalone invert-guard AC into the named admission/resolution failing-test ACs (baseline failure + pass after fix; failure if guard/wiring inverted). |
| **R9** | **`v1-behaviors.md`**: add one catalog line for pipeline `intent` + `debate` realizability/resolution with file sources, or a brief documented exemption with rationale (catalog line preferred). |

## Rationale

- **R1** closes the light-default trap and matches intent (“validates and resolves like bare `intent` + debate review”).
- **R2–R4** prevent merged code with contradictory operator/architecture docs and half-updated rationale.
- **R5–R8** match spec guidance (prerequisites on subspec, preservation by test citation, failing-test ACs, less duplicate checkbox noise).
- **R9** keeps the v2 parity catalog honest for a real behavior change.

## Not required

- Splitting the single subspec (one seam, one PR).
- Refactoring `intent` + `light` onto bare `intent`.
- Renaming the resolution negative test for `implement` + `none` (optional clarity only).
- Blocking on downstream `pipeline-posture-table-pins-cli-review-acceptance` merge order unless the operator wants an explicit sibling note in Decisions.