# Recover a plan stage from its own durable row

Resolve explicit plan-stage recovery from the failed stage row and its linked run, without changing predecessor-dependent dispatch.

- [ ] [00-resolve-recovery-from-linked-run.md](./00-resolve-recovery-from-linked-run.md) — derive the recovery target and landing from its durable row and linked snapshot, preserve dispatch behavior, and align operator documentation.
