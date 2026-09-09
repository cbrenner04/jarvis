# Account for binding failures before result settlement

A binding whose `invoke` rejects before returning an `InvocationResult` currently escapes `executeWithQuotaFallback`, leaving no attempt and no `invocation_completed` row for the operator to attribute.

- [x] [00-normalize-pre-result-binding-failures.md](./00-normalize-pre-result-binding-failures.md)
