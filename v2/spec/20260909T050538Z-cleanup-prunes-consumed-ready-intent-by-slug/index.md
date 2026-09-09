# Cleanup prunes the consumed ready-intent by slug

`provenIntentPrune` (`cleanup.ts`) and `archiveCompletedSpec` (`cleanup-artifacts.ts`) look for `ready-intents/${spec.name}.md`, but `spec.name` is the timestamped spec directory while ready-intents are slug-named, so the documented byte-match prune is unreachable for every project.

- [x] [00 - Resolve the consumed ready-intent by slug and bytes](./00-resolve-consumed-ready-intent-by-slug.md)
