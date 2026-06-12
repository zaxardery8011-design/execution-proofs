import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { extractClaimTokens, verifyClaim } from "../src/core.js";

test("TRUE_DONE when a claimed file exists", () => {
  const root = makeTempRoot();
  const output = path.join(root, "artifact.txt");
  fs.writeFileSync(output, "ok");

  const result = verifyClaim({
    claim_text: `Done: ${output}`,
    search_roots: [root]
  });

  assert.equal(result.verdict, "TRUE_DONE");
  assert.equal(result.total, 1);
  assert.equal(result.bound, 1);
  assert.equal(result.unbound, 0);
  assert.equal(result.stale, 0);
});

test("PSEUDO_DONE when a claimed file cannot be source-bound", () => {
  const root = makeTempRoot();
  const missing = path.join(root, "missing.txt");

  const result = verifyClaim({
    claim_text: `Done: ${missing}`,
    search_roots: [root]
  });

  assert.equal(result.verdict, "PSEUDO_DONE");
  assert.equal(result.total, 1);
  assert.equal(result.bound, 0);
  assert.equal(result.unbound, 1);
});

test("STALE when a claimed file exists but is older than since_minutes", () => {
  const root = makeTempRoot();
  const output = path.join(root, "old.txt");
  fs.writeFileSync(output, "old");
  const oldTime = new Date(Date.now() - 10 * 60 * 1000);
  fs.utimesSync(output, oldTime, oldTime);

  const result = verifyClaim({
    claim_text: `Done: ${output}`,
    search_roots: [root],
    since_minutes: 1
  });

  assert.equal(result.verdict, "STALE");
  assert.equal(result.total, 1);
  assert.equal(result.bound, 0);
  assert.equal(result.stale, 1);
});

test("relocates a backtick filename by leaf under search roots", () => {
  const root = makeTempRoot();
  const nested = path.join(root, "nested");
  fs.mkdirSync(nested);
  const output = path.join(nested, "report.md");
  fs.writeFileSync(output, "ok");

  const result = verifyClaim({
    claim_text: "Done: `report.md`",
    search_roots: [root]
  });

  assert.equal(result.verdict, "TRUE_DONE");
  assert.equal(result.relocated, 1);
  assert.equal(result.items[0]?.actual, output);
});

test("returns NO_CLAIM when there are no path-like tokens", () => {
  const result = verifyClaim({
    claim_text: "Done."
  });

  assert.equal(result.verdict, "NO_CLAIM");
  assert.equal(result.total, 0);
});

test("extracts POSIX absolute paths and ignores obvious fake tokens", () => {
  const tokens = extractClaimTokens("Done: /home/x/out.txt `1.2.3` `v0` `foo.bar()` `result.json`");

  assert.deepEqual(tokens, ["/home/x/out.txt", "result.json"]);
});

test("STALE when a bound file predates task_started_at", () => {
  const root = makeTempRoot();
  const output = path.join(root, "before-baseline.txt");
  fs.writeFileSync(output, "old enough");

  const modifiedAt = new Date(Date.now() - 60 * 1000);
  fs.utimesSync(output, modifiedAt, modifiedAt);

  const result = verifyClaim({
    claim_text: `Done: ${output}`,
    search_roots: [root],
    since_minutes: 5,
    task_started_at: new Date(Date.now() - 1000).toISOString()
  });

  assert.equal(result.verdict, "STALE");
  assert.equal(result.total, 1);
  assert.equal(result.bound, 0);
  assert.equal(result.stale, 1);
});

test("does not verify tokens mentioned in negative contexts", () => {
  const root = makeTempRoot();
  const output = path.join(root, "real.txt");
  fs.writeFileSync(output, "ok");

  const result = verifyClaim({
    claim_text: "未修改 `skip.txt`; Done: `real.txt`; did not touch `other.txt`; no changes to `third.txt`",
    search_roots: [root]
  });

  assert.equal(result.verdict, "TRUE_DONE");
  assert.equal(result.total, 1);
  assert.equal(result.bound, 1);
  assert.equal(result.items[0]?.claim, "real.txt");
});

test("marks absolute paths outside search roots as out_of_scope without binding them", () => {
  const root = makeTempRoot();
  const outsideRoot = makeTempRoot();
  const outside = path.join(outsideRoot, "outside.txt");
  fs.writeFileSync(outside, "exists but out of scope");

  const result = verifyClaim({
    claim_text: `Done: ${outside}`,
    search_roots: [root]
  });

  assert.equal(result.verdict, "PSEUDO_DONE");
  assert.equal(result.total, 1);
  assert.equal(result.bound, 0);
  assert.equal(result.out_of_scope, 1);
  assert.equal(result.items[0]?.status, "out_of_scope");
  assert.equal(result.items[0]?.actual, null);
  assert.equal(result.items[0]?.mtime, null);
});

function makeTempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "execution-proofs-"));
}
