import { z } from "zod";

import {
  analyzeIssueWithOptionalImage,
  translateSupportContent,
} from "./ai";
import { CloudflareApiError, CloudflareClient } from "./cloudflare";
import {
  generateCaseDraft,
  getRequiredEvidence,
  validateSupportCase,
} from "./support";

const TOKEN_HEADER = "X-Cloudflare-API-Token";
const MAX_REQUEST_BYTES = 6_000_000;

const issueTypeSchema = z.enum([
  "outage",
  "performance",
  "dns",
  "ssl",
  "security",
  "workers",
  "zero-trust",
  "other",
]);

const caseSchema = z.object({
  priority: z.enum(["P1", "P2", "P3", "P4"]).optional(),
  service: z.string().max(100).optional(),
  issueType: issueTypeSchema.optional(),
  zoneName: z.string().max(253).optional(),
  zoneId: z.string().max(64).optional(),
  hostnames: z.string().max(2_000).optional(),
  startedUtc: z.string().max(50).optional(),
  frequency: z.string().max(1_000).optional(),
  impact: z.string().max(5_000).optional(),
  affectedUsers: z.string().max(2_000).optional(),
  expected: z.string().max(5_000).optional(),
  actual: z.string().max(5_000).optional(),
  reproduction: z.string().max(10_000).optional(),
  exampleUrls: z.string().max(5_000).optional(),
  exactErrors: z.string().max(10_000).optional(),
  rayIds: z.string().max(2_000).optional(),
  recentChanges: z.string().max(5_000).optional(),
  originFindings: z.string().max(10_000).optional(),
  attachments: z.string().max(5_000).optional(),
  participants: z.string().max(2_000).optional(),
});

export async function handleApi(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);

  try {
    if (url.pathname === "/api/analyze" && request.method === "POST") {
      const body = z
        .object({
          message: z.string().max(20_000).default(""),
          imageDataUrl: z.string().max(5_700_000).optional(),
        })
        .parse(await readJson(request));
      if (!body.message.trim() && !body.imageDataUrl) {
        return jsonError("Describe the issue or attach a screenshot", 400);
      }
      return Response.json(
        await analyzeIssueWithOptionalImage(
          env.AI,
          body.message,
          body.imageDataUrl,
        ),
      );
    }

    if (url.pathname === "/api/evidence" && request.method === "GET") {
      const issueType = issueTypeSchema.parse(
        url.searchParams.get("issue_type") ?? "other",
      );
      return Response.json({
        issueType,
        evidence: getRequiredEvidence(issueType),
      });
    }

    if (url.pathname === "/api/translate" && request.method === "POST") {
      const body = z
        .object({
          text: z.string().min(1).max(20_000),
          targetLanguage: z.enum(["en", "vi", "km"]),
        })
        .parse(await readJson(request));
      return Response.json(
        await translateSupportContent(
          env.AI,
          body.text,
          body.targetLanguage,
        ),
      );
    }

    if (url.pathname === "/api/case/validate" && request.method === "POST") {
      const supportCase = caseSchema.parse(await readJson(request));
      return Response.json(validateSupportCase(supportCase));
    }

    if (url.pathname === "/api/case/draft" && request.method === "POST") {
      const supportCase = caseSchema.parse(await readJson(request));
      return Response.json(generateCaseDraft(supportCase));
    }

    if (
      url.pathname === "/api/cloudflare/connection" &&
      request.method === "GET"
    ) {
      const client = connectedClient(request);
      return Response.json({
        connected: true,
        token: await client.verifyToken(),
      });
    }

    if (
      url.pathname === "/api/cloudflare/accounts" &&
      request.method === "GET"
    ) {
      const client = connectedClient(request);
      return Response.json({ accounts: await client.listAccounts() });
    }

    if (
      url.pathname === "/api/cloudflare/zones" &&
      request.method === "GET"
    ) {
      const client = connectedClient(request);
      const accountId = url.searchParams.get("account_id") ?? undefined;
      return Response.json({ zones: await client.listZones(accountId) });
    }

    return jsonError("API route not found", 404);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        {
          error: "invalid_request",
          message: error.issues[0]?.message ?? "Invalid request",
          issues: error.issues,
        },
        { status: 400 },
      );
    }
    if (error instanceof CloudflareApiError) {
      return Response.json(
        {
          error: "cloudflare_api_error",
          message: error.message,
          status: error.status,
          guidance:
            error.status === 401 || error.status === 403
              ? "Use an active, least-privilege token scoped to the selected account and zone."
              : undefined,
        },
        { status: error.status >= 400 && error.status < 600 ? error.status : 502 },
      );
    }
    return jsonError(
      error instanceof Error ? error.message : "Unexpected request failure",
      500,
    );
  }
}

function connectedClient(request: Request): CloudflareClient {
  const token = request.headers.get(TOKEN_HEADER)?.trim();
  if (!token) {
    throw new CloudflareApiError(
      `Set ${TOKEN_HEADER}. The token is held in browser memory only.`,
      401,
    );
  }
  return new CloudflareClient(token);
}

async function readJson(request: Request): Promise<unknown> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_REQUEST_BYTES) {
    throw new Error("Request is too large");
  }
  const text = await request.text();
  if (text.length > MAX_REQUEST_BYTES) throw new Error("Request is too large");
  return JSON.parse(text) as unknown;
}

function jsonError(message: string, status: number): Response {
  return Response.json({ error: "request_failed", message }, { status });
}
