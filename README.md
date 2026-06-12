# Execution Proofs
> STATUS: DRAFT — 內部評估中，尚未開源

Execution Proofs is a local MCP server that verifies whether an AI agent's completion claim is source-bound to real output artifacts at runtime. It checks the existence of claimed files and, when requested, whether those files were modified within a freshness window.

| Tool / pattern | Primary layer | What it catches | Execution Proofs difference |
|---|---|---|---|
| Guardrails | Soft semantic filtering | Policy or format violations in model output | Runtime hard artifact verification: claimed files must exist and optionally be fresh. |
| DeepEval | Test-time evaluation | Quality regressions measured by evaluation cases | Runtime gate for completion claims, independent of offline eval suites. |
| soplint | Static behavior checks | Process or SOP drift before or around execution | Runtime proof that claimed output artifacts are physically present. |

Market notes and star counts: TODO（待主腦補）.

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
        "C:\\Users\\User\\Desktop\\AIWORK\\execution-proofs\\dist\\server.js"
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
    "since_minutes": 30
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
  "items": []
}
```

Verdicts:

- `NO_CLAIM`: no path-like output artifact token was found.
- `PSEUDO_DONE`: at least one claimed artifact could not be source-bound.
- `STALE`: all claimed artifacts exist, but at least one is older than `since_minutes`.
- `TRUE_DONE`: all claimed artifacts exist and pass the optional freshness check.

## What It Checks

Token extraction follows the AIWFF source-binding gate semantics:

- absolute Windows paths such as `C:\AIWFF\outbox\result.jsonl`
- backtick-wrapped filenames or relative paths that include a path separator or extension, such as `result.jsonl` or `outbox/result.jsonl`

For each token, Execution Proofs first checks the claimed path directly. If it does not exist, it searches by leaf filename under `search_roots`, excluding `node_modules`, `.git`, and `_backup`. A relocated match is still considered source-bound.

When `since_minutes` is greater than `0`, a bound file must have an mtime within the last N minutes. Older files become `stale`.

## Honest Boundary

Execution Proofs verifies whether claimed output artifact files really exist and whether they are fresh enough. It does not verify that file contents are correct, useful, safe, complete, or semantically aligned with the task. Content correctness still needs tests, review, semantic evaluation, or domain-specific validators.

## Development

```powershell
npm install
npm test
```
