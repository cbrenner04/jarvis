# Stage settlement treats rows owned by a live foreign daemon as live

Startup stage settlement decides liveness from this daemon's in-memory probe plus the entry row's own status alone, so an invocation whose `~shrink` row is `in-progress` under another live daemon rolls up `completed` and settles its stage `succeeded`/`failed` while the work continues.

- [x] [00-foreign-owner-liveness-blocks-settlement.md](00-foreign-owner-liveness-blocks-settlement.md)
