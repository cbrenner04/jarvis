# Notifications wait survives daemon handoff

`waitForIncident` holds one IPC client across `notification_wait` and in-loop `notification_list`; daemon self-handoff closes that socket and today's `requestOrReport` path rethrows `RpcConnectionError`, dropping a backgrounded operator wake until they re-arm manually.

- [ ] [00-wait-reconnect-on-ipc-loss.md](00-wait-reconnect-on-ipc-loss.md) — bounded reconnect inside `waitForIncident`, co-located regressions, operator docs
