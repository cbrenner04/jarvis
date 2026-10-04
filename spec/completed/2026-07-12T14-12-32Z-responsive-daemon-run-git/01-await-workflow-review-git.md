# Await workflow and review Git

Make daemon-hosted workflow and review Git yield without changing review enforcement.

## Decisions

- Convert every daemon-reachable workflow/review Git helper; rules out converting only workflow/review diff rendering while leaving enforcement status, checkout, or clean synchronous.
- Preserve output encoding, max-buffer handling, trimming, ignored stdio, failures, fallbacks, and sequential restore order; rules out semantic drift in review boundaries.
- Keep in-flight Git uncancelled; rules out adding cancellation beyond committed daemon abort/shutdown semantics.

## Tasks

- [ ] Replace synchronous Git execution in workflow changed-file, review-debate rendering, and review-enforcement status, checkout, and clean operations with awaited execution, propagating async contracts through their callers.
- [ ] Preserve review rendering, enforcement, failure fallback, and restore ordering.

## Documentation updates

- Update `v2/docs/v2-architecture.md` with awaited workflow/review Git on daemon-hosted runs.
- Update `v2/docs/v1-behaviors.md` with the changed existing workflow/review behavior.

## Acceptance criteria

- [x] `v2/src/execution/workflow-runner.test.ts` stays green for workflow review rendering behavior.
- [x] `v2/src/execution/review-debate-render.test.ts` stays green for review-debate rendering behavior.
- [x] `v2/src/execution/review-intent-enforcement.test.ts` stays green for review-enforcement status and restoration behavior.
- [x] `v2/docs/v2-architecture.md` and `v2/docs/v1-behaviors.md` document awaited daemon run workflow/review Git.
