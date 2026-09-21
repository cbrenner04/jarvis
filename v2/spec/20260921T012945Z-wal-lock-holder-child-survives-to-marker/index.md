# The WAL concurrency lock holder reaches its marker under concurrent load

`state-store-wal-concurrency.test.ts`'s dual-writer test spawns a `bun --eval` lock holder and awaits `jarvis-lock-held`. The reported flake is a pre-marker child exit; a sweep must capture its diagnostics before a source fix.

- [ ] [00-lock-holder-survives-to-marker.md](./00-lock-holder-survives-to-marker.md)
