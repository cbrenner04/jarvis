# Session logging & log viewer

Unified logging for `jarvis run`: named sessions under `~/.jarvis/sessions/`, outbound/inbound tagging for agent traffic, iteration context (**iteration index** ≠ **primary unchecked checklist task text** via spec parse), registered project key, a tiny local aggregation server multiplexing all sessions, and per-agent verbosity via upstream CLI flags (not transcript filtering).

- [x] [00 — Sessions dir, namespace, project key](./00-sessions-namespace.md)
- [x] [01 — Log server & mandatory connectivity](./01-log-server.md)
- [x] [02 — run loop sinks & tagging](./02-run-logging.md)
- [x] [03 — Agent CLI verbosity](./03-agent-verbosity.md)
