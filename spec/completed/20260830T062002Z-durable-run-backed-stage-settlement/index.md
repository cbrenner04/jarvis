# Settle pipeline stages from durable run rows

- [x] [00 - Durable run-backed stage settlement](./00-durable-run-backed-stage-settlement.md)

Scope: persistence-owned settlement that maps a terminal workflow entry run onto every linked `running` stage row from durable store state alone. Daemon caller migration, deferred-marker writes, and redrive predicate removal are follow-on intents (`daemon-terminal-run-stage-settlement`).
