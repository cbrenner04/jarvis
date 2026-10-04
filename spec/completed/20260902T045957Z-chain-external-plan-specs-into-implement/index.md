# Chain external plan specs into implement

Pipeline plan stages can publish durable specs under the git-disabled external plan home (`~/.jarvis/specs/<safeId>/plans/<name>/`), but chained implement still launches through `preflightGitRoot` git preflight instead of the standalone external-plan admission contract.

Ordered: `00` lands chained external-plan implement dispatch; `01` documents operator-visible behavior.

- [x] [00 - Chain external plan implement dispatch](./00-chain-external-plan-implement-dispatch.md)
- [x] [01 - Document chained external plan implement](./01-document-chained-external-plan-implement.md)
