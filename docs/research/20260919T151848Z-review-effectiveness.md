# September review effectiveness

Same September 1–19 snapshot as [API cost and efficiency](./20260919T151848Z-september-api-cost.md). Companion: [transcript-audit.py](./20260919T151848Z-transcript-audit.py). This study checks whether reviews led to concrete changes; it does not estimate defects prevented or causal return on cost.

## Findings

- Review roles consumed **1,596 calls, 32.07 recorded subprocess hours, and $399.39 in known token value** at the frozen catalog. Only 1,148 calls have priceable usage.
- In a recent 12-group Claude sample, **11 groups produced observed artifact edits**. All four intent and four plan groups changed their documents; three of four implementation groups changed source/tests. An edit is evidence of action, not proof of improvement.
- One implementation review spent **four calls, 43.35 seconds, and $0.89** requesting that informational spec checkboxes be ticked. The actuator correctly declined; no source, test, or document changed.
- Reviewers found concrete problems, but their conclusions still needed checking. One actuator narrowed an overstated fence-bypass finding. A plan review accepted a deduplication premise that implementation review later overturned.

## Population and sampling

Include roles `critic`, `adversary`, `advocate`, `adjudicator`, and `actuator` across all agents. Durations sum subprocess time, including failures. Cost covers known tokens only and uses the frozen catalog; see the API-cost report for Claude repricing and missing-usage coverage.

| Workflow | Calls | Priced calls | Subprocess minutes | Catalog token value |
|---|---|---|---|---|
| Intent | 231 | 173 | 214.04 | $29.21 |
| Plan | 777 | 557 | 895.05 | $199.20 |
| Implement | 588 | 418 | 814.81 | $170.97 |

For manual inspection, group by `(workflow, run_id, attempt_id)`, require an actuator and a critic/adjudicator, and require every invocation in the group to match a retained Claude transcript. Select the latest four eligible groups per workflow by final invocation timestamp. A group can contain multiple actuator calls. The sample totals **41 calls, 32.35 minutes, and $14.16**; all sampled calls are priced.

This deliberately selects recent, retained Claude reviews that reached an actuator. It excludes review groups that never reached that stage and is not representative of every agent, task, or review outcome. In particular, 11/12 is not a population effectiveness rate.

## Observed review outcomes

Run IDs below are unique prefixes; the script emits full run, attempt, and invocation IDs. Findings were checked against reviewer text, successful edit/write results or shell edits, and visible test output. Final agent summaries alone were not treated as proof. Counts of successful edit tools omit edits made through Bash.

| Workflow / run | Finding and observed response | Calls | Minutes | Catalog value |
|---|---|---|---|---|
| Intent / `a52e7a6d` | Pipe truncation: requested concrete reproduction and stderr/exit assertions; intent rewritten, but actuator acknowledged that the stderr fixture remained unidentified. | 2 | 0.50 | $0.28 |
| Intent / `8dae4527` | Daemon rebind flakes: clarified positive/negative waits, repeat command, and failure injection; shell edit wrote the revised intent. | 2 | 0.86 | $0.35 |
| Intent / `f939a3b1` | Rebased lane publication: found an undeclared cross-layer prerequisite; two actuator calls revised the design toward local inference instead of a missing flag. | 3 | 4.63 | $1.23 |
| Intent / `7854dd26` | Gate allowset: tightened the test requirement to all eight named failure branches; intent edited. | 2 | 2.13 | $0.54 |
| Plan / `01720e40` | Repair prompt: combined stdout/stderr slicing could omit the failure; spec rewritten with per-stream markers and fixtures. | 4 | 1.97 | $1.13 |
| Plan / `8a8e41b2` | Settled marker: clarified exclusions and upgrade behavior; spec rewritten. Its accepted repeat-cause deduplication premise was later reversed in implementation review. | 4 | 2.12 | $1.17 |
| Plan / `cb8de620` | Redrive gates: identified enqueue/release race and ownership gaps; actuator split the spec and added decisions/tests after an initial rejected shell command. | 4 | 3.17 | $1.37 |
| Plan / `57ea3345` | CLI flush: identified drain hang, early pipe closure, and fixture portability issues; spec rewritten, with stderr fixture size constrained by argument limits. | 4 | 1.26 | $0.87 |
| Implement / `2106a81a` | Gate allowset: verdict only requested informational Tasks checkboxes; actuator inspected the spec and refused the read-only edit. No implementation change. | 4 | 0.72 | $0.89 |
| Implement / `73db6b4c` | Redrive gates: swallowed thrown-resume errors and missing exhaustion event; source/tests changed. Tool output shows 31 tests passing and typecheck completing. | 4 | 1.79 | $1.92 |
| Implement / `881bdd22` | Repair fences: post-revert markdown validation and missing-log resumability; source/tests changed. Initial 436-pass/1-fail run was followed by a 437-pass/0-fail result. Actuator corrected the claim that two other fences were also bypassed. | 4 | 5.84 | $1.94 |
| Implement / `f3fbcd63` | Settled marker: fail/resume/fail was wrongly deduplicated; source, tests, and docs changed. Targeted 64-test run passed after a fixture correction, but full-suite verification remained incomplete and integration hit `EPERM`. | 4 | 7.35 | $2.45 |

The checkbox-only verdict conflicts with the [implementation rules](../../../prompts/implement/rules.md), which tell implementers to tick acceptance criteria and not other items. It is a concrete example of review effort that produced no actionable repair. Conversely, the redrive and marker cases include behavior changes and corresponding test work. This snapshot does not establish whether those changes merged or remained correct afterward.

## What to measure next

Record each finding's disposition: accepted behavior fix, document/spec clarification, already satisfied, rejected premise, or blocked. Link accepted findings to changed files and verification results. Count review-only bookkeeping and repeated findings separately from repairs.

For a policy comparison, match tasks by size and kind, then measure total implementation plus review plus later repair tokens and confirmed regressions. The paired plan/implementation marker case shows why counting accepted findings or adjudicator approvals alone overstates confidence. This evidence supports refining review instructions and measuring outcomes; it cannot determine which debate role to remove.

## Reproduction

Run the command in the [transcript report](./20260919T151848Z-transcript-context.md#reproduction). JSON fields `review_total`, `review_by_workflow`, and `review_sample` reproduce population totals and sample selection. Manual dispositions above require reading the selected native transcripts; the script reports tool counts, not semantic correctness. Frozen inputs and raw transcript text remain in local scratch, outside the PR.
