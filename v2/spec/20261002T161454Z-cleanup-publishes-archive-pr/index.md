# Cleanup publishes its archive branch as a PR

After apply, `jarvis cleanup` pushes each project's `cleanup/archive-*` publication target and opens or reuses one ready archive PR via `publishArchiveReady` (subspec 01; requires exported `publishArchiveReady`); staged-only branches recover on the next apply instead of blocking (subspec 00).

- [x] [00-staged-branch-recovery.md](./00-staged-branch-recovery.md)
- [ ] [01-apply-end-archive-publication.md](./01-apply-end-archive-publication.md)
