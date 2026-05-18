# Pre-ready branch checks

repo: cbrenner04/jarvis

PRs are being moved from draft to ready while CI checks still fail. Make `.github/workflows/ci.yml` the source of truth for the local pre-ready gate by adding a composite `ready` script that mirrors CI step-for-step, plus the missing Biome fix scripts called out in the intent. Update developer docs so the new workflow is discoverable.

- [x] [00 - Add Biome fix scripts and `ready` composite to package.json](./00-package-json-scripts.md)
- [ ] [01 - Update developer docs for the pre-ready gate](./01-docs-update.md)
