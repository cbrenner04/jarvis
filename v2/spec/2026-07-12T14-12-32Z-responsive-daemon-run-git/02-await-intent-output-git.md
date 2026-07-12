# Await intent-output Git

Make daemon-hosted intent-output Git yield without changing staged-output checks.

## Decisions

- Convert every daemon-reachable intent-output Git call; rules out converting status while leaving diff or Git-directory lookup synchronous.
- Preserve UTF-8 output, trimming, failure fallback, and status-before-diff ordering; rules out changing staged-output validation semantics.
- Keep in-flight Git uncancelled; rules out adding cancellation beyond committed daemon abort/shutdown semantics.

## Tasks

- [ ] Replace synchronous Git execution in intent-output change detection and ownership lookup with awaited execution, propagating async contracts through workflow callers.
- [ ] Preserve staged-output validation, fallback, and ordering behavior.

## Documentation updates

- Update `v2/docs/v2-architecture.md` with awaited intent-output Git on daemon-hosted runs.
- Update `v2/docs/v1-behaviors.md` with the changed existing intent-output behavior.

## Acceptance criteria

- [ ] `v2/src/execution/intent-output.test.ts` stays green for intent-output validation and fallback behavior.
- [ ] `v2/docs/v2-architecture.md` and `v2/docs/v1-behaviors.md` document awaited daemon run intent-output Git.
