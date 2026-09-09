# Gate-invocation slot is owned

The gate-invocation serialization slot in `write-loop.ts` is an unowned module-global boolean released by whoever calls `releaseAgentGateInvocationSlot`, `MAX_CONCURRENT_AGENT_GATE_INVOCATIONS` is exported but never read, and the finalization-repair settle path never releases a held gate. #3617 closed the cross-lane clobber from ordinary iteration settle; this spec closes the rest.

- [ ] [00 - Owned gate-invocation lease](./00-owned-gate-invocation-lease.md)
