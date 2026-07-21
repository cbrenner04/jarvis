- Ensure the test establishes the initial `loadedRevision` differs from the invoking revision. Otherwise it could pass without exercising revision advancement, violating the acceptance criterion.

- Ensure every in-process daemon runtime started by the test is cleanly stopped, including timers, signal listeners, IPC, and owned resources, without exiting the test process. Leaked runtime state makes the suite order-dependent and accumulates process-level handlers.
