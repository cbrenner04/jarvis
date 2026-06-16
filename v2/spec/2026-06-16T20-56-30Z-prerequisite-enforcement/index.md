# Prerequisite enforcement

The plan draft agent gates itself: before producing any spec content it judges
whether each consumed ready-intent `## Prerequisites` behavior is legibly
present in existing repo files. Fail-closed — a behavior it cannot confirm is
treated as absent, plan exits non-zero naming the unconfirmed behavior(s), and
no spec is drafted. The signal is the repo, read by the draft agent plan already
runs: no completion record, no behavior ledger, no preflight agent.

- [ ] [00 - Draft-agent prerequisite gate](./00-draft-agent-prerequisite-gate.md)
