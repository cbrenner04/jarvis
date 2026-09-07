# Subspec completion inventory relativizes against the worktree root

`buildSubspecCompletionInventory` resolves linked subspecs in the managed worktree but relativizes against `projectRoot`, so git-enabled runs drop every entry, `iteration_timeout` is non-resumable by construction, and the documented completed-subspec recovery never fires.

- [ ] [00 - Write-loop subspec inventory](./00-write-loop-subspec-inventory.md)
