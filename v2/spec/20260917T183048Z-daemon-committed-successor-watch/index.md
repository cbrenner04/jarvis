# Outgoing generation rebinds the public address when its committed successor dies

Seed: `v2/spec/seeds/daemon-survives-committed-successor-death.md`.

After a self-handoff commits, the outgoing generation stops caring about the successor (`handoff_rollback` is a no-op once `state === "committed"`, and `startDaemon` returns). A successor that dies right after commit leaves `~/.jarvis/daemon.sock` unbound while the outgoing generation is still up running work.

- [x] [00-committed-successor-watch.md](00-committed-successor-watch.md)
