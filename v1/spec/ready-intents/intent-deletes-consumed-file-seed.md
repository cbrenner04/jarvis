---
name: intent-deletes-consumed-file-seed
description: Running jarvis1 intent against a file seed deletes that seed file in the same fan-out PR
---

# Intent fan-out deletes the consumed file seed

When `jarvis1 intent <path-to-seed-file>` fans a file seed out into authored
intents, the consumed seed file is deleted as part of the same change, so the
split PR both adds the `ready-intents/` files and removes the now-consumed seed.

Scope:
- Applies only to file seeds; inline-text seeds have no file to delete.
- Committed mode: the seed deletion is staged into the same commit/PR as the
  emitted intents.
- No-commit mode: the consumed seed file under the external seeds home is
  deleted on successful fan-out (no PR exists there).
- Deletion happens only on successful fan-out; a run that aborts (structural
  validation failure, no emitted files) leaves the seed in place.

This reverses the current "raw seed is read but left in place after fan-out"
behavior documented in `v1/docs/intent-mode.md`; that doc and any other durable
description of seed lifecycle must be updated to match.

## Prerequisites

- jarvis1 intent accepts a file seed and fans it out into ready-intents
- intent committed mode opens a draft PR containing the fan-out changes
