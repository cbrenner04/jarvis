- Review steps must emit daemon/TUI progress for critic and actuator starts and a terminal completed/stopped state. Their snapshot rows must not remain pending while execution is active or after it ends; review is explicitly included in observable workflow snapshots.

- Review invocations must receive the workflow telemetry context so every critic/actuator binding attempt emits the standard `invocation_completed` telemetry with correct workflow, step, run, attempt, and role context. The runner’s shared telemetry contract must apply equally to review steps.

- Durable role documentation must consistently recognize `review` as a behavior and map `actuator` to verdict application in both review primitives. The current taxonomy contradicts the implemented/spec-required `critic → review` mapping and would mislead programmatic workflow authors.
