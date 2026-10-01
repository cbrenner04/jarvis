# Resume admits lane PR republish opt-in

Operators who intentionally re-run a lane after closing its lane PR need an explicit resume flag; completion publication already honors `allowLanePrRepublish` on `CompletionPublisherInput`, but no CLI or daemon resume path sets it.

Prerequisites: [lane-pr-history-blocks-republish](../completed/20261001T010442Z-lane-pr-history-blocks-republish/index.md) (publisher guard + opt-in field) and [lane-pr-outcomes-settle-runs-and-stages](../20261001T145917Z-lane-pr-outcomes-settle-runs-and-stages/index.md) (terminal settlement without duplicate draft when opt-in is absent).

## Decisions

- After subspec 00 merges alone, CLI/RPC may accept `--allow-lane-pr-republish` without completion-publication effect until subspec 01 lands — rules out operator docs or runbook copy implying republish works mid-rollout.

- [x] [00 — Resume republish opt-in CLI and RPC admission](./00-resume-republish-opt-in-cli-rpc.md)
- [ ] [01 — Resume dispatch threads republish opt-in to completion publication](./01-resume-republish-opt-in-publication-wiring.md)
