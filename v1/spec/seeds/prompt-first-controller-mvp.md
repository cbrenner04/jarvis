# Prompt-first controller MVP

Design the first MVP of `jarvis "<intent>"` that replaces the TUI operator agent.

Desired UX:

```sh
jarvis "fix foo"
jarvis "continue spec 3"
jarvis "review current branch"
jarvis "ship it"
```

Core principle: the prompt is only intent. Jarvis owns state, routing, workflows, policy, execution, recovery, and reporting.

Architecture:

```text
Prompt
-> Intent Router
-> State Resolver
-> Controller
-> Workflow Graph
-> Bounded Agents
-> Tools / Existing Jarvis Commands
-> Results
-> Controller decides next step
```

Key boundaries:

- Router owns control flow.
- Agents perform bounded work.
- Tools are implementation details.
- State is durable.
- Errors return to the controller as classified events.
- Recovery is workflow-driven, not freeform chat.

Mental model:

- Jarvis = kernel
- Intent router = scheduler
- State store = memory
- Policy = permissions
- Workflows = programs
- Agents = workers
- Tools = syscalls
- Prompt = user intent

Immediate design task:

Design the first MVP of `jarvis "<intent>"`. It should:

1. Parse natural-language intent.
2. Resolve repo/runbook/state.
3. Choose a workflow.
4. Execute existing Jarvis commands.
5. Classify errors.
6. Resume/repair/escalate/block as appropriate.
7. Persist job state.
8. Produce a clear status summary.

Do not build a chat wrapper. Build a controller loop.

This should land as v1 work, with heavy emphasis on documenting the resulting behavior in `v2/docs/v1-behaviors.md` so v2 can preserve or deliberately revise the controller contract.

## God talking

For the first iteration, errors should exit. They should, upon exit, give a summary to understand why exit and a command to resume
Jarvis should exit early if it isn't 100% sure how to route. So in that case, the error should ask the user to improve its prompt. 
There are three options for what jarvis does, the prompt given is the seed, the prompt given resumes a seed/intent, error with ask for more information.
