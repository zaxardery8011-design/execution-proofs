import fs from "node:fs";
import path from "node:path";

export type Verdict = "TRUE_DONE" | "PSEUDO_DONE" | "STALE" | "NO_CLAIM";
export type ItemStatus = "bound" | "stale" | "unbound";

export interface VerificationItem {
  claim: string;
  status: ItemStatus;
  actual: string | null;
  mtime: string | null;
  relocated: boolean;
  age_min: number | null;
}

export interface VerificationResult {
  verdict: Verdict;
  total: number;
  bound: number;
  relocated: number;
  unbound: number;
  stale: number;
  items: VerificationItem[];
}

export interface VerifyClaimOptions {
  claim_text: string;
  search_roots?: string[];
  since_minutes?: number;
}

const ABSOLUTE_WINDOWS_PATH = /[A-Za-z]:\\[^\s`'"<>|]+/g;
const BACKTICK_TOKEN = /`([^`]+)`/g;
const EXCLUDED_SEARCH_SEGMENTS = new Set(["node_modules", ".git", "_backup"]);

export function extractClaimTokens(claimText: string): string[] {
  const tokens = new Set<string>();

  for (const match of claimText.matchAll(ABSOLUTE_WINDOWS_PATH)) {
    tokens.add(match[0]);
  }

  for (const match of claimText.matchAll(BACKTICK_TOKEN)) {
    const token = match[1];
    if (/[\\/]/.test(token) || /\.\w{1,5}$/.test(token)) {
      tokens.add(token);
    }
  }

  return [...tokens];
}

export function verifyClaim(options: VerifyClaimOptions): VerificationResult {
  const sinceMinutes = options.since_minutes ?? 0;
  const searchRoots = options.search_roots?.length ? options.search_roots : [process.cwd()];
  const now = Date.now();
  const items = extractClaimTokens(options.claim_text).map((token) => {
    const clean = cleanToken(token);
    const leaf = getLeafName(clean);
    let found = getExistingFile(clean);
    let relocated = false;

    if (!found && leaf) {
      found = findFirstByLeaf(searchRoots, leaf);
      relocated = Boolean(found);
    }

    if (!found) {
      return {
        claim: token,
        status: "unbound" as const,
        actual: null,
        mtime: null,
        relocated: false,
        age_min: null
      };
    }

    const ageMin = roundOneDecimal((now - found.mtimeMs) / 60000);
    const fresh = sinceMinutes <= 0 || ageMin <= sinceMinutes;

    return {
      claim: token,
      status: fresh ? ("bound" as const) : ("stale" as const),
      actual: found.fullPath,
      mtime: found.mtime.toISOString(),
      relocated,
      age_min: ageMin
    };
  });

  const unbound = items.filter((item) => item.status === "unbound").length;
  const stale = items.filter((item) => item.status === "stale").length;
  const verdict: Verdict =
    items.length === 0 ? "NO_CLAIM" : unbound > 0 ? "PSEUDO_DONE" : stale > 0 ? "STALE" : "TRUE_DONE";

  return {
    verdict,
    total: items.length,
    bound: items.filter((item) => item.status === "bound").length,
    relocated: items.filter((item) => item.relocated).length,
    unbound,
    stale,
    items
  };
}

function cleanToken(token: string): string {
  return token.replace(/[.,；;、)`"']+$/u, "");
}

function getLeafName(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).pop() ?? "";
}

function getExistingFile(candidate: string): { fullPath: string; mtime: Date; mtimeMs: number } | null {
  const candidates = path.isAbsolute(candidate) ? [candidate] : [candidate, path.resolve(candidate)];

  for (const item of candidates) {
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

function findFirstByLeaf(searchRoots: string[], leaf: string): { fullPath: string; mtime: Date; mtimeMs: number } | null {
  for (const root of searchRoots) {
    const found = findFirstByLeafInRoot(path.resolve(root), leaf);
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

function roundOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}
