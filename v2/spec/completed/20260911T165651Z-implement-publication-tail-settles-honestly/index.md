# The implement publication tail settles honestly

Closes the first half of [[implement-publication-tail]]: a workflow implement run that settles `completed` with a real commit, nothing pushed, no PR, no review row and no publication row, and no diagnostic anywhere.

- [x] [00-non-complete-step-settles-its-row.md](./00-non-complete-step-settles-its-row.md) — a workflow step that ends non-`complete` settles its own durable row and records why
