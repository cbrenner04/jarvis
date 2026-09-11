# Retain terminal pipelines in the default RPC projection

Default `pipeline_list` returns every non-terminal pipeline plus the 50 newest terminal pipelines; `sinceMs` or an exact derived-state filter bypasses that cap. Durable rows are untouched.

- [x] [00-pipeline-list-terminal-retention.md](./00-pipeline-list-terminal-retention.md) — apply terminal retention and filtered-query bypass to `pipeline_list`
