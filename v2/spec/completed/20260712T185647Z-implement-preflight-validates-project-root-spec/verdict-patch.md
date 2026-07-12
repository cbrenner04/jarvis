- Ignore unresolved registry roots unrelated to the supplied spec. Implement matching must validate the matched registered project root, so a stale unrelated entry cannot block an otherwise valid launch.

- Add execution-level coverage for a first launch with no branch worktree: it must create/reach the write runtime using project-relative spec and artifact paths. Builder-only assertions do not satisfy the required workflow execution coverage.
