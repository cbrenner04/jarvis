- The daemon slice must define how one workflow-backed `list` row is identified and assembled from per-step durable state. The spec currently requires workflow progress on a single selected run, but the prerequisites only guarantee per-step records; without a pinned workflow-level grouping/source, the row contract is not reviewable and different implementations could surface different runs.

- The daemon slice must pin the source of authored step metadata for live and quiescent workflows: authored order, `stepId`, `role`, and never-started future steps. The intent requires showing the active step plus prior and future steps; that outcome is not achievable from durable step attempts alone if authored workflow structure is not available after the runner moves on or exits.

- The daemon slice must define the workflow-step status vocabulary and its relationship to existing run/outcome semantics. The wire payload adds observable state consumed by the TUI, so the allowed statuses and when terminal outcome is present need to be explicit; otherwise parser behavior and operator-visible rendering are under-specified.

- The TUI slice must pin what “single-step view unchanged” preserves in current monitor behavior, including existing steering/inline feedback semantics for the selected run. This is needed because the work changes an existing monitor surface, and the spec guidance requires behavior-preserving work to state the preserved observable behavior clearly enough to prevent regressions.

- The TUI slice must replace the preservation acceptance criterion with executable behavior anchors instead of a prior spec citation. Preservation criteria need test/source anchors so review checks real shipped behavior rather than a paraphrase of earlier planning text.

- The spec should also resolve the terminal presentation for a completed workflow-backed run. The operator outcome is incomplete if the draft only defines active and early-stopped cases; completion is a normal end state for the workflow/step view and should not be left implicit.
