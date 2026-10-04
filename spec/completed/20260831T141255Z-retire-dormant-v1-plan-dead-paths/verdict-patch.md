- Align telemetry docs with current behavior: `v1/docs/run-loop.md` must identify only `draft` and `review` as live plan emitters, distinguishing any retained compatibility types if needed. It currently contradicts `v2/docs/v1-behaviors.md`.

- Ensure retired input cannot produce `plan-name-only-ok` at runtime. Invalid phases must be rejected or otherwise prevented from generating valid-looking telemetry, with regression coverage. The current interpolation violates the acceptance criterion and durable claim that the writer cannot emit the retired exit reason.
