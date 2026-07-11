import fs from "node:fs";
import path from "node:path";

export type Verdict = "TRUE_DONE" | "PSEUDO_DONE" | "STALE" | "NO_CLAIM";
export type ItemStatus = "bound" | "stale" | "unbound" | "out_of_scope";
export const VERIFIER_VERSION = "execution-proofs-cr4a-v1";

export interface VerificationItem {
  claim: string;
  status: ItemStatus;
  actual: string | null;
  mtime: string | null;
  relocated: boolean;
  out_of_root: boolean;
  age_min: number | null;
  reason: string;
}

export interface VerificationResult {
  verdict: Verdict;
  total: number;
  bound: number;
  relocated: number;
  unbound: number;
  stale: number;
  out_of_scope: number;
  items: VerificationItem[];
}

export interface VerifyClaimOptions {
  claim_text: string;
  search_roots?: string[];
  since_minutes?: number;
  task_started_at?: string;
  task_finished_at?: string;
  fresh_until?: string;
}

const ABSOLUTE_WINDOWS_PATH = /[A-Za-z]:\\[^\s`'"<>|]+/g;
const ABSOLUTE_POSIX_PATH = /(^|[\s([{"'`])((?:\/(?!\/)[^\s`'"<>|]+)+)/g;
const BACKTICK_TOKEN = /`([^`]+)`/g;
const EXCLUDED_SEARCH_SEGMENTS = new Set(["node_modules", ".git", "_backup"]);

export function extractClaimTokens(claimText: string): string[] {
  const tokens = new Map<string, number>();

  for (const match of claimText.matchAll(ABSOLUTE_WINDOWS_PATH)) {
    addToken(tokens, claimText, match[0], match.index ?? 0);
  }

  for (const match of claimText.matchAll(ABSOLUTE_POSIX_PATH)) {
    const token = match[2];
    const index = (match.index ?? 0) + match[1].length;
    addToken(tokens, claimText, token, index);
  }

  for (const match of claimText.matchAll(BACKTICK_TOKEN)) {
    const token = match[1];
    addToken(tokens, claimText, token, (match.index ?? 0) + 1);
  }

  return [...tokens.keys()];
}

export function verifyClaim(options: VerifyClaimOptions): VerificationResult {
  const sinceMinutes = options.since_minutes ?? 0;
  const searchRoots = options.search_roots?.length ? options.search_roots : [process.cwd()];
  const resolvedSearchRoots = searchRoots.map((root) => path.resolve(root));
  const taskStartedAtMs = parseOptionalTimestamp(options.task_started_at, "task_started_at");
  const freshUntilMs = parseOptionalTimestamp(options.task_finished_at ?? options.fresh_until, "task_finished_at/fresh_until");
  const now = Date.now();
  const items = extractClaimTokens(options.claim_text).map((token) => {
    const clean = cleanToken(token);
    const leaf = getLeafName(clean);
    const absolute = isAbsolutePath(clean);
    const outOfRoot = absolute && !isWithinAnySearchRoot(clean, resolvedSearchRoots);

    if (outOfRoot) {
      const found = getExactExistingFile(clean);
      if (found) {
        return buildItem(token, found, false, true, sinceMinutes, taskStartedAtMs, freshUntilMs, now);
      }
      return {
        claim: token,
        status: "unbound" as const,
        actual: null,
        mtime: null,
        relocated: false,
        out_of_root: true,
        age_min: null,
        reason: "out_of_root_missing"
      };
    }

    let found = getExistingFile(clean, resolvedSearchRoots);
    let relocated = false;

    if (!found && leaf) {
      found = findFirstByLeaf(resolvedSearchRoots, leaf);
      relocated = Boolean(found);
    }

    if (!found) {
      return {
        claim: token,
        status: "unbound" as const,
        actual: null,
        mtime: null,
        relocated: false,
        out_of_root: false,
        age_min: null,
        reason: "missing"
      };
    }

    return buildItem(token, found, relocated, false, sinceMinutes, taskStartedAtMs, freshUntilMs, now);
  });

  const unbound = items.filter((item) => item.status === "unbound").length;
  const stale = items.filter((item) => item.status === "stale").length;
  const outOfScope = items.filter((item) => item.status === "out_of_scope").length;
  const verdict: Verdict =
    items.length === 0
      ? "NO_CLAIM"
      : unbound > 0 || outOfScope > 0
        ? "PSEUDO_DONE"
        : stale > 0
          ? "STALE"
          : "TRUE_DONE";

  return {
    verdict,
    total: items.length,
    bound: items.filter((item) => item.status === "bound").length,
    relocated: items.filter((item) => item.relocated).length,
    unbound,
    stale,
    out_of_scope: outOfScope,
    items
  };
}

function addToken(tokens: Map<string, number>, claimText: string, token: string, index: number): void {
  const clean = cleanToken(token);
  if (!isPathLikeToken(clean) || isNegatedContext(claimText, index, token.length)) {
    return;
  }

  if (!tokens.has(token)) {
    tokens.set(token, index);
  }
}

function cleanToken(token: string): string {
  return token.replace(/[.,；;、)`"']+$/u, "");
}

function isPathLikeToken(token: string): boolean {
  if (!token || /[()[\]{};]/u.test(token)) {
    return false;
  }

  if (isAbsolutePath(token) || /[\\/]/.test(token)) {
    return true;
  }

  return /\.[A-Za-z][A-Za-z0-9]{0,7}$/u.test(token);
}

function isAbsolutePath(value: string): boolean {
  return path.isAbsolute(value) || path.win32.isAbsolute(value) || path.posix.isAbsolute(value);
}

function isNegatedContext(claimText: string, index: number, length: number): boolean {
  const sentenceStart = Math.max(
    claimText.lastIndexOf("\n", index - 1),
    claimText.lastIndexOf(".", index - 1),
    claimText.lastIndexOf("。", index - 1),
    claimText.lastIndexOf("!", index - 1),
    claimText.lastIndexOf("！", index - 1),
    claimText.lastIndexOf("?", index - 1),
    claimText.lastIndexOf("？", index - 1)
  );
  const afterToken = index + length;
  const sentenceEndCandidates = ["\n", ".", "。", "!", "！", "?", "？"]
    .map((marker) => claimText.indexOf(marker, afterToken))
    .filter((item) => item >= 0);
  const sentenceEnd = sentenceEndCandidates.length ? Math.min(...sentenceEndCandidates) : claimText.length;
  const before = claimText.slice(sentenceStart + 1, index).toLowerCase();
  const after = claimText.slice(afterToken, sentenceEnd).toLowerCase();

  return (
    /(?:未|沒有|没|無|无)(?:修改|產生|产生|建立|新增|寫入|写入|碰|動|动)[\s`'"]*$/u.test(before) ||
    /(?:did\s+not|didn't|do\s+not|don't|never)\s+(?:touch|modify|change|create|generate|write|edit|update|produce)[\s`'"]*$/u.test(
      before
    ) ||
    /no\s+changes?\s+to[\s`'"]*$/u.test(before) ||
    /^\s*(?:was|were)?\s*(?:not|never)\s+(?:touched|modified|changed|created|generated|written|edited|updated|produced)/u.test(
      after
    ) ||
    /^\s*(?:未|沒有|没|無|无)(?:修改|產生|产生|建立|新增|寫入|写入|碰|動|动)/u.test(after)
  );
}

function getLeafName(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).pop() ?? "";
}

function getExistingFile(candidate: string, searchRoots: string[]): { fullPath: string; mtime: Date; mtimeMs: number } | null {
  const candidates = isAbsolutePath(candidate) ? [candidate] : searchRoots.map((root) => path.resolve(root, candidate));

  for (const item of candidates) {
    if (!isWithinAnySearchRoot(item, searchRoots)) {
      continue;
    }

    try {
      const stats = fs.statSync(item);
      if (stats.isFile()) {
        return { fullPath: path.resolve(item), mtime: stats.mtime, mtimeMs: stats.mtimeMs };
      }
    } catch {
      // Keep source-binding fail-safe: a missed direct path falls through to relocation.
    }
  }

  return null;
}

function getExactExistingFile(candidate: string): { fullPath: string; mtime: Date; mtimeMs: number } | null {
  try {
    const stats = fs.statSync(candidate);
    if (stats.isFile()) {
      return { fullPath: path.resolve(candidate), mtime: stats.mtime, mtimeMs: stats.mtimeMs };
    }
  } catch {
    // Exact out-of-root verification is fail-open at the verifier layer: missing/inaccessible means unbound.
  }

  return null;
}

function buildItem(
  claim: string,
  found: { fullPath: string; mtime: Date; mtimeMs: number },
  relocated: boolean,
  outOfRoot: boolean,
  sinceMinutes: number,
  taskStartedAtMs: number | null,
  freshUntilMs: number | null,
  now: number
): VerificationItem {
  const ageMin = roundOneDecimal((now - found.mtimeMs) / 60000);
  const freshByWindow = sinceMinutes <= 0 || ageMin <= sinceMinutes;
  const freshByBaseline = taskStartedAtMs === null || found.mtimeMs >= taskStartedAtMs;
  const freshByUpper = freshUntilMs === null || found.mtimeMs <= freshUntilMs;
  const fresh = freshByWindow && freshByBaseline && freshByUpper;

  return {
    claim,
    status: fresh ? ("bound" as const) : ("stale" as const),
    actual: found.fullPath,
    mtime: found.mtime.toISOString(),
    relocated,
    out_of_root: outOfRoot,
    age_min: ageMin,
    reason: getItemReason(fresh, freshByWindow, freshByBaseline, freshByUpper, relocated, outOfRoot)
  };
}

function getItemReason(
  fresh: boolean,
  freshByWindow: boolean,
  freshByBaseline: boolean,
  freshByUpper: boolean,
  relocated: boolean,
  outOfRoot: boolean
): string {
  if (!freshByBaseline) {
    return outOfRoot ? "out_of_root_before_task_started_at" : "before_task_started_at";
  }

  if (!freshByUpper) {
    return outOfRoot ? "out_of_root_after_fresh_until" : "after_fresh_until";
  }

  if (!freshByWindow) {
    return outOfRoot ? "out_of_root_older_than_since_minutes" : "older_than_since_minutes";
  }

  if (fresh) {
    if (outOfRoot) {
      return "out_of_root_exact_bound";
    }

    return relocated ? "relocated_by_leaf" : "exact_bound";
  }

  return "stale";
}

function findFirstByLeaf(searchRoots: string[], leaf: string): { fullPath: string; mtime: Date; mtimeMs: number } | null {
  for (const root of searchRoots) {
    const found = findFirstByLeafInRoot(root, leaf);
    if (found) {
      return found;
    }
  }

  return null;
}

function findFirstByLeafInRoot(root: string, leaf: string): { fullPath: string; mtime: Date; mtimeMs: number } | null {
  let entries: fs.Dirent[];

  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      if (EXCLUDED_SEARCH_SEGMENTS.has(entry.name)) {
        continue;
      }

      const found = findFirstByLeafInRoot(fullPath, leaf);
      if (found) {
        return found;
      }
      continue;
    }

    if (entry.isFile() && entry.name === leaf) {
      const stats = fs.statSync(fullPath);
      return { fullPath: path.resolve(fullPath), mtime: stats.mtime, mtimeMs: stats.mtimeMs };
    }
  }

  return null;
}

function isWithinAnySearchRoot(candidate: string, searchRoots: string[]): boolean {
  const resolvedCandidate = path.resolve(candidate);
  return searchRoots.some((root) => isWithinRoot(resolvedCandidate, root));
}

function isWithinRoot(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function parseOptionalTimestamp(value: string | undefined, fieldName: string): number | null {
  if (value === undefined) {
    return null;
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`${fieldName} must be a valid ISO timestamp.`);
  }

  return parsed;
}

function roundOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}
