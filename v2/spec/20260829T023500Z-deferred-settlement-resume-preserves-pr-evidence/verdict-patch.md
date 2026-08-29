- Strengthen the resume regression so the final deferred workflow stage’s reloaded PR evidence is present in the artifact consumed by terminal publication. It must verify the executor input and fail against the pre-fix behavior; the current test checks an earlier stage while terminal publication consumes another stage.

- Cover restart-sweep deferred settlement for both outcomes promised by the decision ledger and docs: complete PR evidence reaches the successful stage artifact, and missing evidence on a final `ready`/`merge` workflow stage produces `completion_publication_missing_pr_evidence` without invoking terminal publication.

- Finalize the routing index so completed subspec 00 is checked. Its acceptance criteria are complete, and the stale index state violates spec-routing bookkeeping; this must occur through Jarvis-owned finalization rather than manual spec editing.
