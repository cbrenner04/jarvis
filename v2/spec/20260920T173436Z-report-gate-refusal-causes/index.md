# Report gate-refusal cause and retry state

`jarvis run list` / `run wait` expose one undifferentiated `gate_invocation_refused` error. Project the durable refusal cause and bounded slot re-drive evidence through the shared operator error and render it.

- [ ] [00-operator-error-carries-refusal-cause.md](./00-operator-error-carries-refusal-cause.md) — daemon operator error carries cause, slot count, and bound; `message` remedy is cause-specific
- [ ] [01-cli-renders-refusal-cause.md](./01-cli-renders-refusal-cause.md) — `run list` renders cause and count/bound; `run wait` preserves the structured fields
