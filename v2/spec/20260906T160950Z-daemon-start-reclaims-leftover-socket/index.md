# Daemon start reclaims its own leftover socket

After abrupt daemon death, a keyed socket file can survive with no listener bound. `removeStaleSocketPath` removes only on probe `stale`, so probe `absent` on an occupied path or probe timeout on a loaded machine skips removal and `listen` fails `EADDRINUSE` permanently; the parent surfaces only `Daemon process N died during startup` while `jarvis cleanup` already classifies the same path dead.

- [ ] [00 - Occupancy-aware socket reclaim on daemon start](./00-occupancy-aware-socket-reclaim.md)
- [ ] [01 - Unify socket classifier for cleanup reaping](./01-unify-socket-classifier-cleanup.md)
- [ ] [02 - Surface unrecoverable socket bind errors](./02-surface-unrecoverable-bind-error.md)
- [ ] [03 - Operator runbook and v1 parity docs](./03-operator-and-parity-docs.md)
