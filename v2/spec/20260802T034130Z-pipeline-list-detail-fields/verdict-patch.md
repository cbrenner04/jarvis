- Make `PipelineSnapshot` match the guaranteed wire contract: terminal publication fields and stage `id`, `position`, `artifact`, and `failureDetail` must be required. Only `terminalAction` and `seedPath` remain optional.
- Update affected typed fixtures/consumers to provide the guaranteed fields without expanding TUI rendering scope.

This is required because the spec and durable docs promise these fields are always present, including `null` and falsy JSON values; optional typing permits invalid snapshots to typecheck.
