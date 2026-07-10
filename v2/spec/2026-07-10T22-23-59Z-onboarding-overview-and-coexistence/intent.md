---
name: onboarding-overview-and-coexistence
description: New-user orientation page — what jarvis is, the two binaries, when to use which, v2 vocabulary
---

# Onboarding: overview and v1/v2 coexistence

The "start here" page for a new user. A short, user-facing orientation doc (not a
design reference) that a newcomer reads first, then follows into install and the
first-run walkthrough.

Covers:

- What jarvis is at a user level (drives a coding-agent CLI against Markdown specs; does not implement an agent).
- The two coexisting binaries: `jarvis1` (stable v1 daily driver) and `jarvis` (v2 orchestration layer). When to reach for each; v2 is opt-in and never required.
- The user-level v2 vocabulary — workflows, behaviors, roles — enough to make the v2 command surface make sense, without duplicating the design docs.
- A map: links out to install/setup, the first-run walkthrough, and the deeper `v2/docs/` references rather than restating them.

Keep it terse and link-first; it orients, it does not exhaustively document.

## Prerequisites

- The `jarvis` (v2) binary is installed and runnable alongside `jarvis1`.
- The v2 workflow/behavior/role vocabulary is settled in reference docs.
