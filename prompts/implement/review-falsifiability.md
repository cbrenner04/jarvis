---
id: implement.review.falsifiability
behavior: implement-review-falsifiability
kind: fragment
revision: 2
---
## Review falsifiability

For each acceptance criterion ticked in a completed spec or proposed in a draft spec (unchecked included), judge whether the cited evidence (named test, path pin, or stated verification) would fail against pre-change code — the branch diff context when reviewing against a completed spec's branch, or the repository base when reviewing a draft spec. Treat a criterion whose cited evidence would pass before and after the change as a finding in itself.

Look for defect shapes (do not recite this list — use it as a lens): a guard that fails open where the spec says fail closed; a branch made unreachable by an earlier short-circuit while a criterion claims coverage; a value computed or persisted then ignored by its consumer; a test that re-derives the production rule instead of asserting the intended outcome independently; a predicate correct for one input and wrong for several when fixtures only exercise one.

When no real defect is found: emit an empty verdict (critic); report no manufactured problems (adversary); concede only findings the evidence supports (advocate). Do not invent issues to satisfy the review.
