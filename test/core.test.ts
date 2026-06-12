import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { verifyClaim } from "../src/core.js";

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

function makeTempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "execution-proofs-"));
}
