# Base-ref probe exonerates only on a conclusive failure at base

The ready-gate base-ref probe reported `fail` for paths that pass on base, settling `ready_gate_out_of_scope` (`nextAction: "stop"`) for lane-caused regressions (runs `75ca2a7a`, `823a8185`, `29b222de`). Only a conclusive test failure at a verified base tree may exonerate a path.

- [ ] [00 — Conclusive base-ref probe](00-conclusive-base-ref-probe.md)
