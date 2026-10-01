# Dead-export guard stderr names demote-or-delete, not import-to-satisfy

Ready-gate repair sees `guard-dead-exports` stderr in `GATE_OUTPUT` but the line omits fix direction, so agents import dead symbols from paths outside the repair fence. One subspec appends operator-facing repair guidance to each finding and aligns `coding-standards.md`.

- [ ] [00 - Dead-export guard stderr repair direction](./00-dead-export-guard-stderr-repair-direction.md)
