# Persist daemon run admission and expose it through the CLI

Store admitted workflow runs durably before daemon dispatch, let daemon request handling reload the
stored run after restart, and make `jarvis run list` display the persisted admission state.

The behavior necessarily crosses these primary implementation surfaces in dependency order:

1. `v2/src/persistence/` owns durable run admission.
2. `v2/src/daemon/` owns restart-safe request handling.
3. `v2/src/commands/run.ts` owns operator-visible CLI run listing.
