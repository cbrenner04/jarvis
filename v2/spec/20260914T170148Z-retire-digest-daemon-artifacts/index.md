# Retire digest-keyed daemon artifacts

Cleanup stops treating `daemon-<16hex>.{sock,pid,log}` triplets as daemon service units: it discovers legacy units from all three filename kinds, classifies them by PID or a non-RPC liveness probe (never a `health` RPC or service connection), reaps only proven-dead units, stops writing keyed PID/log files, and never offers the stable `daemon.sock`/`daemon.pid`/`daemon.log`.

- [ ] [00-legacy-keyed-artifact-reaping](00-legacy-keyed-artifact-reaping.md)
