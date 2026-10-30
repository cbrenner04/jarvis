# Plan rebuild reuses landed spec directory

`buildPlanWorkflowSteps` mints a fresh `<UTC>-<name>` on every build; retried git-enabled plan stages land sibling trees beside the first. One subspec: reuse the newest branch-added matching directory for repo-spec plans when the `plan/<name>` branch already carries one.

- [ ] [00 — reuse landed plan spec dir on rebuild](./00-reuse-landed-plan-spec-dir-on-rebuild.md)
