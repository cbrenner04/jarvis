# Pipeline daemon resolution across live sockets

Build the resolution seam that lets pipeline RPCs reach the daemon that actually owns a pipeline, instead of only the invoking digest's socket. Verb adoption is later work.

- [x] [00 — `pipeline_owner` RPC answers durable pipeline ownership](./00-pipeline-owner-rpc.md)
- [x] [01 — Pipeline daemon resolution walks every live keyed socket](./01-pipeline-daemon-resolution.md)
