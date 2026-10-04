# Pipeline verbs accept the id `pipeline list` prints

`pipeline list` prints `pipelineId.slice(0, 8)` and no pipeline verb resolves a prefix, so the id the listing hands the operator is rejected by the adjacent command as `pipeline_not_found`.

- [x] [00 - Resolve pipeline id prefixes in the daemon and print unique prefixes](./00-resolve-pipeline-id-prefixes.md)
