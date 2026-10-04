- Clarify that this spec delivers only the durable-log contract prerequisite, not production emission. Production wiring must be identified as a subsequent execution-loop concern; otherwise the stated persistence problem remains only partially resolved.

- Define `completionCommitError` semantics: it applies to `completion_commit_failed` events, and the spec must state whether it may coexist with `publicationFailure`. Optionality alone establishes backward compatibility, not valid usage.

- Strengthen backward-compatibility coverage to read/tail a raw pre-field serialized JSONL record. Appending a newly typed event without the field does not verify compatibility with existing durable logs.

- Keep the regression claim explicitly contract-level: failure against baseline may come from type checking because generic structured-log serialization can preserve unknown JSON properties without a runtime failure.
