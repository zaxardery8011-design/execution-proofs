#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { verifyClaim } from "./core.js";

const server = new Server(
  {
    name: "execution-proofs",
    version: "0.1.0"
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "verify_claim",
      description: "Verify whether claimed output artifacts exist and optionally whether they are fresh enough.",
      inputSchema: {
        type: "object",
        properties: {
          claim_text: {
            type: "string",
            description: "Completion claim text that may contain artifact paths or backtick-wrapped filenames."
          },
          search_roots: {
            type: "array",
            items: { type: "string" },
            description: "Roots used to relocate missing claimed paths by leaf filename. Defaults to current working directory."
          },
          since_minutes: {
            type: "number",
            description: "Freshness window in minutes. 0 disables freshness checks.",
            default: 0
          },
          task_started_at: {
            type: "string",
            description: "Optional ISO timestamp. Claimed artifacts older than this baseline are stale."
          }
        },
        required: ["claim_text"],
        additionalProperties: false
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "verify_claim") {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  const args = parseVerifyClaimArgs(request.params.arguments);
  const result = verifyClaim(args);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2)
      }
    ],
    structuredContent: result
  };
});

await server.connect(new StdioServerTransport());

function parseVerifyClaimArgs(value: unknown): {
  claim_text: string;
  search_roots?: string[];
  since_minutes?: number;
  task_started_at?: string;
} {
  if (!value || typeof value !== "object") {
    throw new Error("verify_claim requires an object argument.");
  }

  const input = value as Record<string, unknown>;

  if (typeof input.claim_text !== "string") {
    throw new Error("verify_claim.claim_text must be a string.");
  }

  if (input.search_roots !== undefined) {
    if (!Array.isArray(input.search_roots) || !input.search_roots.every((item) => typeof item === "string")) {
      throw new Error("verify_claim.search_roots must be an array of strings.");
    }
  }

  if (input.since_minutes !== undefined && typeof input.since_minutes !== "number") {
    throw new Error("verify_claim.since_minutes must be a number.");
  }

  if (input.task_started_at !== undefined && typeof input.task_started_at !== "string") {
    throw new Error("verify_claim.task_started_at must be a string.");
  }

  return {
    claim_text: input.claim_text,
    search_roots: input.search_roots as string[] | undefined,
    since_minutes: input.since_minutes as number | undefined,
    task_started_at: input.task_started_at as string | undefined
  };
}
