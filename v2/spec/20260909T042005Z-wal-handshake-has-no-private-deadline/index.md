# WAL handshake has no private deadline

`state-store-wal-concurrency.test.ts` gives its lock-holder subprocess a private 10-second startup deadline. Under `test:v2`'s concurrency that deadline measures machine load, fails on `main` in the ready gate's base-ref probe too, and upgrades a scheduling flake into a non-resumable `ready_gate_out_of_scope` (run `6dc830ec`).

- [x] [00 - Handshake waits under the suite timeout](./00-handshake-waits-under-the-suite-timeout.md)
