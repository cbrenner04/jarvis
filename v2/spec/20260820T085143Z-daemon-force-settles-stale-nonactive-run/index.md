# Daemon Force-Settles a Stale Non-Active Run to `killed`

repo: cbrenner04/jarvis

- [ ] [00 - Force-settle a non-active run on the kill RPC](./00-force-settle-non-active-run-on-kill.md)

Scope note: this spec ships the daemon RPC only. No `jarvis run kill --force` CLI flag and no TUI affordance land here — an operator can't reach force-kill yet, only future daemon consumers (and manual RPC calls) can. The CLI/TUI admission surface is a deliberate follow-up intent, not a dropped requirement.
