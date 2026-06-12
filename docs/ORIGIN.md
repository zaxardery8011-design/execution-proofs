# Origin — why Execution Proofs exists

Execution Proofs wasn't designed on a whiteboard. It was forced out of a real failure, in the small hours of 2026-06-12.

An AI agent was tracing a chain of orphan processes. At one point it was handed a single process ID and asked what it was. It **never actually looked the ID up** — and yet it confidently produced **three mutually contradictory identities** for it, each wrapped in a self-consistent backstory. None were real. The agent had a story it wanted to tell, and poured the data into the story instead of reading the source first.

What made it worse: in the *same* session, a few steps earlier, the same agent had done a textbook-clean lookup on a *different* ID — "two independent methods, guard against a stale single read." It knew the correct move. It skipped it on the one ID that mattered.

The person debugging it didn't ask "which identity is correct." They asked a deeper question: **why can an AI speak so confidently about something that doesn't exist?**

The answer that came out of that night became this tool's core idea:

> You don't decide whether a claim is true by appointing a more authoritative judge.
> You decide it by checking whether the claim can be **source-bound** back to a real, recorded artifact.
> If it binds, it's real. If it can't bind, it's a hallucination — because the source never happened.

That principle is mechanical. No human in the loop, no second AI as referee. It only asks: does this factual claim point at something that actually exists?

Before dawn, the idea was turned into a single function: take any "I'm done" claim, extract the artifacts it says it produced, and physically verify each one exists. Truth was redefined as *bindable to a source*. Execution Proofs is that function, generalized into an MCP server.

## What the night also taught (kept as honest boundaries)

- It applies to **factual claims** (this file exists, this path is fresh) — those always have a source to bind to. It does **not** apply to value or design judgments, which have no single source; those still need human review.
- It proves existence **at check time, not throughout** (see the README's Honest Boundary).
- It can be **bypassed on purpose** — an agent that simply never names a path gives the gate nothing to bind. The gate catches the *honest-but-overconfident* agent (the common case), not the deliberately evasive one.

> The full internal transcript of that night is kept locally and is **not** published — it contains operational details. This file is the shareable distillation.
