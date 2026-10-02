# Fan-out pipelines run terminal publication once per settled lane

Fan-out pipelines today refuse terminal publication at `resolveTerminalPublicationInput`, commit a pipeline-level failure, and never run merge/ready terminal actions or per-lane supersede even when every implement lane succeeded.

## Subspecs

- [ ] [00 — Per-lane terminal publication settlement](./00-per-lane-terminal-publication-settlement.md)
- [ ] [01 — Fan-out terminal supersede on close](./01-fan-out-terminal-supersede-close.md)
