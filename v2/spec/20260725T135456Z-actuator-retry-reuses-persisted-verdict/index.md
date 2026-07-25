# Actuator retry reuses persisted verdict

repo: cbrenner04/jarvis

Re-dispatching after a post-commit review actuator failure currently replays expensive
implement shrink and full debate roles even though `verdictPath` already holds the adjudicated
verdict. Retry should re-invoke only the actuator from that file.

- [x] [00 - Actuator-only retry on re-dispatch](./00-actuator-only-retry-on-redispatch.md)
