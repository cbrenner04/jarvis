# Hand off daemon generations at one stable address

Today a daemon's public identity is its executable digest: socket, PID file, and process log are all `daemon-<key>.*`, so rebuilding the source starts a separately addressed service and leaves the previous generation reachable only through digest-keyed artifacts. This spec makes one stable public address (`~/.jarvis/daemon.sock`) the single caller-facing endpoint, demotes the digest-keyed socket to a private successor-only endpoint, and adds a handoff in which an incoming generation takes the public address while the outgoing generation drains its admitted work and exits.

- [x] [00-stable-public-daemon-address.md](./00-stable-public-daemon-address.md) — daemon serves the stable public socket and keeps the digest-keyed socket as a private endpoint; public PID ownership.
- [ ] [01-handoff-changeover-protocol.md](./01-handoff-changeover-protocol.md) — admission cutoff, public-address release, incoming bind, ready only after the incoming generation answers.
- [x] [02-outgoing-generation-drain-and-exit.md](./02-outgoing-generation-drain-and-exit.md) — incoming generation observes drain over the handoff channel; idle outgoing generation exits owning nothing public.
- [x] [03-legacy-keyed-daemon-migration.md](./03-legacy-keyed-daemon-migration.md) — a live pre-stable digest-keyed daemon is drained as a legacy outgoing generation, with no legacy-side code change.
