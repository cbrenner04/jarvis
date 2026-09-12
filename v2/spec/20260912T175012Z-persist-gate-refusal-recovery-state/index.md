# Persist gate-refusal recovery state

Durable run evidence round-trips the gate-refusal cause and slot re-drive count across the process boundary, so daemon recovery can tell a waitable slot condition from a fixed headroom condition and bound slot re-drives.

- [ ] [00-durable-gate-refusal-recovery-state.md](./00-durable-gate-refusal-recovery-state.md) — durable run-row recovery state: closed refusal cause, gate command, slot re-drive count, legacy fallback
- [ ] [01-refusal-settlement-records-recovery-state.md](./01-refusal-settlement-records-recovery-state.md) — the refusal settlement writes that state and the terminal log entry carries the count
