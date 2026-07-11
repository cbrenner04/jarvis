- Reject every non-registered workflow name—including inherited property names—with exactly `usage: jarvis run workflow <implement> [flags]\n`, exit `1`, and no daemon contact. This is required for the missing/unknown-name contract and for `implement` to remain the sole registered preset.

- Make the production launcher’s default preset lookup use the canonical `WORKFLOW_PRESET_BUILDERS` registry, while retaining the test injection seam. The current duplicate inline mapping can drift from the declared registry, undermining the required name-to-builder dispatch boundary.
