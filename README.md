# Execution Proofs

Execution Proofs is a local MCP server that verifies whether an AI agent's completion claim is source-bound to real output artifacts at runtime. It checks the existence of claimed files and, when requested, whether those files were modified within a freshness window.

The core verifier supports both ESM `import` and CommonJS `require` consumers.

Positioning: Execution Proofs is a **lightweight physical telemetry gate** — the first ultra-fast, low-cost filter before CI, tests, review, or LLM-as-judge workflows.

| Tool / pattern | Primary layer | What it catches | Execution Proofs difference |
|---|---|---|---|
| Guardrails | Soft semantic filtering | Policy or format violations in model output | Runtime hard artifact verification: claimed files must exist and optionally be fresh. |
| DeepEval | Test-time evaluation | Quality regressions measured by evaluation cases | Runtime gate for completion claims, independent of offline eval suites. |
| soplint | Static behavior checks | Process or SOP drift before or around execution | Runtime proof that claimed output artifacts are physically present. |
| AgentLiar | Static diff analysis + optional LLM judge | Placeholders / weak tests / scope-narrowing inside a supplied git diff | We never judge diff quality — we extract artifact tokens from the completion claim itself and physically verify the files exist and are fresh, with zero LLM. AgentLiar requires an externally supplied diff and has no file-existence check. |

## MCP Usage

Build once:

```powershell
npm install
npm run build
```

Add the server to an MCP client configuration:

```json
{
  "mcpServers": {
    "execution-proofs": {
      "command": "node",
      "args": [
        "<repo>/dist/server.js"
      ]
    }
  }
}
```

The server exposes one tool:

```json
{
  "name": "verify_claim",
  "arguments": {
    "claim_text": "Done: C:\\AIWFF\\outbox\\result.jsonl",
    "search_roots": ["C:\\AIWFF"],
    "since_minutes": 30,
    "task_started_at": "2026-06-12T08:40:00.000Z"
  }
}
```

Response shape:

```json
{
  "verdict": "TRUE_DONE",
  "total": 1,
  "bound": 1,
  "relocated": 0,
  "unbound": 0,
  "stale": 0,
  "out_of_scope": 0,
  "items": []
}
```

Verdicts:

- `NO_CLAIM`: no path-like output artifact token was found.
- `PSEUDO_DONE`: at least one claimed artifact could not be source-bound, or an absolute path is outside `search_roots`.
- `STALE`: all in-scope claimed artifacts exist, but at least one is older than `since_minutes` or predates `task_started_at`.
- `TRUE_DONE`: all claimed artifacts exist and pass the optional freshness check.

## What It Checks

Token extraction follows the AIWFF source-binding gate semantics:

- absolute Windows paths such as `C:\AIWFF\outbox\result.jsonl` (example path, replace with your own)
- absolute POSIX paths such as `/home/x/out.txt`
- backtick-wrapped filenames or relative paths that include a path separator or extension, such as `result.jsonl` or `outbox/result.jsonl`

Obvious non-path tokens such as version numbers (`1.2.3`), short labels (`v0`), and code symbols are ignored. Tokens in negative contexts such as "未修改 X", "did not touch X", or "no changes to X" are also ignored, because they are not completion claims.

For each token, Execution Proofs first checks the claimed path directly, but only inside `search_roots`. Absolute paths outside `search_roots` are marked `out_of_scope` and are not stat'ed. If an in-scope token does not exist directly, it searches by leaf filename under `search_roots`, excluding `node_modules`, `.git`, and `_backup`. A relocated match is still considered source-bound.

When `since_minutes` is greater than `0`, a bound file must have an mtime within the last N minutes. Older files become `stale`.

When `task_started_at` is supplied as an ISO timestamp, a bound file must have an mtime at or after that baseline. Files older than the task baseline become `stale`, even if they are within the rolling `since_minutes` window.

## Honest Boundary

Execution Proofs verifies whether claimed output artifact files really exist and whether they are fresh enough. It does not verify that file contents are correct, useful, safe, complete, or semantically aligned with the task. Content correctness still needs tests, review, semantic evaluation, or domain-specific validators.

It also proves existence **at check time, not throughout**. If an artifact was produced and then deleted, overwritten, or moved before the check, the gate sees only "not present now" and cannot distinguish that from "never produced". For workflows where that gap matters, stamp a receipt (path + content hash + timestamp) at production time and reconcile against it later — an opt-in mode, deliberately kept out of the zero-config core.

It can be deliberately bypassed. An agent can change its claim format, avoid mentioning paths, or otherwise omit artifact tokens so the gate has nothing concrete to verify.

Container, VM, and host filesystem isolation can produce false negatives. If the agent writes artifacts inside an isolated environment but Execution Proofs runs on the host, the host-side check may not see those files and may incorrectly mark the claim unbound.

## Development

```powershell
npm install
npm test
```

## Related — the discipline toolchain

Part of a small set of tools for making AI agents finish work and stay disciplined — **engine + guardrails**:

- **[aiwff-runtime](https://github.com/zaxardery8011-design/aiwff-runtime)** — the local agent runtime (the engine that runs disciplined agents)
- **[soplint](https://github.com/zaxardery8011-design/soplint)** — static SOP-compliance audit for AI work nodes
- **[execution-proofs](https://github.com/zaxardery8011-design/execution-proofs)** — MCP telemetry gateway: force agents to prove "done" with real files & timestamps (this repo)

> 引擎（跑得動的 agent）＋護欄（審紀律、逼證明），同一套「讓 AI 守紀律」哲學的兩面。

## Beyond the gate

This tool catches one shape of failure: a completion claim that isn't bound to a real file.

There are other shapes it cannot see, and they are quieter:

- a health check whose predicate is **structurally impossible to satisfy**, so the ring stays yellow forever and everyone assumes the work just isn't done yet
- a writer and a reader using **different fields or different channels**, so one column is silently null for weeks
- an alert rule whose "false positive" branch requires a state the subject **can never be in at first observation**, so it fires every single time
- a green dashboard where the **checker itself** returned null and null compared as pass

None of these surface as errors. They surface as nothing at all — which is why they survive for months.

We hit all four while building our own agent system, and we keep a catalogue of the shapes with the mechanical root cause for each. If your agents report success and your dashboards are green, but you cannot actually prove the work happened — [open an issue](https://github.com/zaxardery8011-design/execution-proofs/issues) and describe what you're seeing. A rough description is fine; these cases are hard to put into words, which is exactly why they survive.

Two other things you're welcome to open an issue for:

- **Drop a repo link and ask what it actually does, and whether it's worth adopting.** We check whether it is *alive* — recent commits, whether issues get answered, whether anything actually depends on it — instead of just restating the README. If it looks abandoned, we'll say so.
- **Tell us about a silent failure shape we haven't catalogued.** New shapes are genuinely useful to us, and we'll add them here with credit.

Reliability audits for production agent systems are available. The tools here stay MIT and free regardless — that part isn't going to change.
