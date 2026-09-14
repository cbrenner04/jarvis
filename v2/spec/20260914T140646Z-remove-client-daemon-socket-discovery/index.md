# Remove client-side daemon socket discovery

Cleanup admission (`cleanup --abandon`) and `run list`/`run log` still enumerate or merge digest-keyed daemon sockets client-side instead of relying on the stable daemon's own draining-generation routing; pipeline verbs already query the stable socket only. The TUI separately discovers sockets and builds its own cross-socket ownership maps. CLI bootstrap's executable-digest resolution is untouched by any of this — it names only the private successor socket a new `daemon start` hands its predecessor through during upgrade, never a client routing target. One PR; delete now-orphaned discovery modules only after 00 and 01 have removed their last consumers.

- [ ] [00 Cleanup admission queries only the stable socket](00-cli-bootstrap-and-cleanup-stable-paths.md)
- [ ] [01 Run commands use only the stable socket](01-run-pipeline-stable-socket.md)
- [ ] [02 TUI stable connection and client-layer structural guard](02-tui-stable-connection-and-structural-guard.md)
