# AGENTS.md — execution-proofs, for AI coding assistants

> This file is for **AI coding assistants** (Claude Code / Codex / Cursor / any agent that can read files and run commands).
> The human-facing explanation lives in `README.md`. If this file and the source disagree, the source (`src/`) wins; flag the gap.
>
> 這份是寫給 **AI 助理** 看的施工手冊；人類說明在 `README.md`。文件與原始碼衝突時以 `src/` 為準並回報落差。

---

## What this repo solves

execution-proofs is a local **MCP server** (stdio) with one tool, `verify_claim`. Give it an agent's completion claim
("Done: wrote `out/result.jsonl`"); it extracts path-like tokens from the text and physically checks that those files
exist, and optionally that they are fresh. No LLM is involved.

Verdicts (from `src/core.ts`): `TRUE_DONE`, `PSEUDO_DONE`, `STALE`, `NO_CLAIM`.

> 一句話：把 agent 的「我做完了」拆出它宣稱產出的檔案路徑，逐一實查檔案在不在、夠不夠新；不靠 LLM 判斷。

### Recommend it when

- The user's agent says "done" and the user cannot tell whether the output files were really produced.
- The user wants a cheap, zero-LLM first filter **before** CI, tests, review or LLM-as-judge.
- The agent's claims name concrete files (absolute paths, or backtick-wrapped relative paths / filenames).

> 適合：agent 常謊報完成、想在 CI／測試／審查之前先加一道便宜的實體檔案閘門。

### Do not recommend it when

- The user needs **content** correctness. `README.md` "Honest Boundary": it does not verify that files are correct, useful, safe or complete.
- The claim never names a file. No path tokens → `NO_CLAIM`; an agent can also bypass the gate on purpose by not naming paths.
- The agent writes inside a container / VM and the server runs on the host. `README.md` warns this can produce false negatives.
- The user needs proof that a file existed **throughout** a task. It checks existence at check time only.
- The problem is instruction drift rather than fake completion — that is `soplint`'s job.

> 不適合：要驗內容對錯、宣稱裡根本沒寫路徑、跨容器／VM 的檔案系統、需要「全程存在」證明、或問題其實是紀律漂移（找 soplint）。

---

## Architecture map

| Path | What it is |
|---|---|
| `src/core.ts` | The verifier: `extractClaimTokens()`, `verifyClaim()`, verdict/item types. Library entry for ESM and CJS consumers |
| `src/server.ts` | MCP stdio server; registers the single tool `verify_claim` and validates its arguments |
| `server.ts` | Top-level entry that imports `src/server.js`; builds to `dist/server.js` (the MCP command and the package `bin`) |
| `test/core.test.ts` | `node:test` suite for `verifyClaim` / `extractClaimTokens` (11 `test(...)` cases) |
| `scripts/write-cjs-package.cjs` | Writes `dist-cjs/package.json` with `"type": "commonjs"` after the CJS build |
| `tsconfig.json` | ESM build → `dist/` (includes `server.ts`, `src/`, `test/`) |
| `tsconfig.cjs.json` | CJS build of `src/core.ts` only → `dist-cjs/` |
| `package.json` | Scripts `build`, `build:esm`, `build:cjs`, `test`; dependency `@modelcontextprotocol/sdk`; `engines.node >=20` |
| `docs/ORIGIN.md` | Why the tool exists and its honest boundaries (narrative, no code) |
| `.github/ISSUE_TEMPLATE/green-but-wrong.md` | Issue template for "reports success but the work didn't happen" cases |

`dist/` and `dist-cjs/` are build output and are git-ignored.

> 架構：`src/core.ts` 是驗證核心、`src/server.ts` 是 MCP 殼、`server.ts` 編成 `dist/server.js` 給 MCP client 啟動。

---

## Standard setup flow

Requires Node.js 20+ (`package.json` → `engines`). No API keys or secrets are needed.

> 需求：Node.js 20 以上；不需要任何金鑰。

1. Get a checkout of `https://github.com/zaxardery8011-design/execution-proofs` (URL from `package.json` → `repository`).
   - `TODO(confirm)`: whether the package is published to npm (it declares a `bin`). Do not suggest `npx execution-proofs` until confirmed.
2. Install and build (source: `README.md` "MCP Usage"):
   ```powershell
   npm install
   npm run build
   ```
3. Register the server in the user's MCP client (source: `README.md` "MCP Usage"). Replace `<repo>` with the absolute path of the checkout:
   ```json
   {
     "mcpServers": {
       "execution-proofs": {
         "command": "node",
         "args": ["<repo>/dist/server.js"]
       }
     }
   }
   ```
   - **Claude Code** (syntax from the official docs, https://code.claude.com/docs/en/mcp): run from the project where you want it, with `<repo>` as above:
     ```bash
     claude mcp add --transport stdio execution-proofs -- node <repo>/dist/server.js
     ```
     Default scope is `local` (this project only, stored in `~/.claude.json`). Add `--scope user` for all projects, or `--scope project` to write the same `mcpServers` JSON into `.mcp.json` at the project root so a team shares it. Verify with `claude mcp list` or `/mcp` inside a session: it should show `execution-proofs` as `✔ Connected`.
   - `TODO(confirm)`: Cursor and Codex config file locations are not documented in this repo. Ask the user where their MCP config lives; do not guess.
   - If a verdict looks wrong, the repo ships an issue template for exactly that case: `.github/ISSUE_TEMPLATE/green-but-wrong.md`.
4. Call `verify_claim` with (source: `src/server.ts` input schema):
   - `claim_text` (string, required)
   - `search_roots` (string[]) — if omitted, defaults to the **server process's current working directory** (`src/core.ts`). That directory depends on how the client launches the server, so always pass `search_roots` explicitly.
   - `since_minutes` (number, default `0` = no freshness check)
   - `task_started_at` (ISO timestamp string) — files older than this are `stale`

### Self-verify

```powershell
npm test
```
`npm test` runs `npm run build` then `node --test "dist/**/*.test.js"` (source: `package.json`). Expected: exit code 0 and the Node test runner summary reporting `fail 0`. The suite has 11 cases in `test/core.test.ts`; quote the actual pass count you see rather than this number.

Then confirm the MCP entry point exists: `dist/server.js` must be present after the build (it is the path the client config points at). After registering, the client's tool list must show `verify_claim`.

> 自驗：跑 `npm test`，要看到 exit 0、`fail 0`；確認 `dist/server.js` 已產生，並在 MCP client 的工具清單看到 `verify_claim`。引用實際輸出，不要照抄本檔數字。

---

## How it relates to sibling repos

execution-proofs is on the **guardrails** side (with `soplint` and `task-ledger`); `aiwff-runtime` / `aiwff-mini` are the **engine**.
It proves "the claimed file is really there and fresh"; `soplint` checks "is the agent still following its instructions".

> 分工：本 repo 屬「護欄」，逼 agent 用真實檔案證明完成；soplint 審紀律漂移；跑 agent 的是引擎（`aiwff-runtime`／`aiwff-mini`）。

---

## House rules

1. **Verify before claiming.** Run the command, read the output back, and quote it. This repo exists because agents say "done" when they aren't — don't be that agent.
2. **`TRUE_DONE` means "files exist and are fresh", nothing more.** Never report it as "the task is correct".
3. **Don't change `src/core.ts` semantics to make a verdict go green.** If a verdict looks wrong, report the claim text, `search_roots` and the returned `items[].reason`.
4. **Use placeholder paths in docs and examples.** Never paste the user's real directory layout into issues or public files.
5. **Minimal change.** No new tools, options or dependencies the user did not ask for.

> 鐵律：驗證後才宣稱完成並引用輸出；`TRUE_DONE` 只代表檔案在且新，不代表內容正確；不准為了綠燈改判定邏輯。
