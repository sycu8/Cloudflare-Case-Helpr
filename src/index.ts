import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpHandler } from "agents/mcp";
import { z } from "zod";

import { CloudflareApiError, CloudflareClient } from "./cloudflare";
import {
  normalizeRayId,
  summarizeHttpErrors,
  validateId,
  validateLogWindow,
} from "./diagnostics";

const TOKEN_HEADER = "X-Cloudflare-API-Token";
const idSchema = z
  .string()
  .regex(/^[a-f0-9]{32}$/i, "Must be a 32-character hexadecimal ID");
const utcSchema = z
  .string()
  .datetime({ offset: false })
  .endsWith("Z", "Timestamp must be UTC and end in Z");

function createServer(client: CloudflareClient): McpServer {
  const server = new McpServer({
    name: "Cloudflare Troubleshooting",
    version: "0.1.0",
  });

  server.registerTool(
    "check_cloudflare_connection",
    {
      description:
        "Verify the read-only Cloudflare API token supplied in the MCP transport header. Use this before troubleshooting.",
      inputSchema: {},
    },
    async () =>
      toolResult({
        connected: true,
        token: await client.verifyToken(),
        security:
          "The token was read from the transport header and is never returned by this tool.",
      }),
  );

  server.registerTool(
    "list_cloudflare_accounts",
    {
      description:
        "List Cloudflare accounts visible to the connected token. Requires Account Settings Read.",
      inputSchema: {},
    },
    async () => toolResult({ accounts: await client.listAccounts() }),
  );

  server.registerTool(
    "list_cloudflare_zones",
    {
      description:
        "List zones visible to the connected token, optionally limited to one account. Requires Zone Read.",
      inputSchema: {
        account_id: idSchema.optional(),
      },
    },
    async ({ account_id }) =>
      toolResult({ zones: await client.listZones(account_id) }),
  );

  server.registerTool(
    "lookup_http_request_by_ray_id",
    {
      description:
        "Retrieve an Enterprise HTTP request log by Cloudflare Ray ID. Requires Logs Read. Query strings are removed by default to reduce accidental disclosure.",
      inputSchema: {
        zone_id: idSchema,
        ray_id: z.string().min(16).max(40),
        include_query_string: z.boolean().default(false),
      },
    },
    async ({ zone_id, ray_id, include_query_string }) =>
      toolResult({
        records: await client.lookupRayId(
          validateId(zone_id, "zone_id"),
          normalizeRayId(ray_id),
          include_query_string,
        ),
      }),
  );

  server.registerTool(
    "get_http_error_logs",
    {
      description:
        "Retrieve a bounded sample of Enterprise HTTP request logs for a UTC window of at most one hour and no more than seven days old. Requires Logs Read.",
      inputSchema: {
        zone_id: idSchema,
        start_utc: utcSchema,
        end_utc: utcSchema,
        hostname: z.string().min(1).max(253).optional(),
        status_code: z.number().int().min(400).max(599).optional(),
        limit: z.number().int().min(1).max(100).default(50),
        include_query_string: z.boolean().default(false),
      },
    },
    async ({
      zone_id,
      start_utc,
      end_utc,
      hostname,
      status_code,
      limit,
      include_query_string,
    }) => {
      validateLogWindow(start_utc, end_utc);
      const records = await client.getHttpLogs({
        zoneId: validateId(zone_id, "zone_id"),
        start: start_utc,
        end: end_utc,
        limit,
        includeQueryString: include_query_string,
        ...(hostname ? { hostname } : {}),
        ...(status_code !== undefined ? { statusCode: status_code } : {}),
      });
      return toolResult({
        record_count: records.length,
        diagnoses: summarizeHttpErrors(records),
        records,
        notice:
          "Logpull samples are not guaranteed to be sorted. Confirm likely findings against origin and application logs.",
      });
    },
  );

  server.registerTool(
    "get_http_error_analytics",
    {
      description:
        "Get aggregated HTTP 4xx/5xx analytics grouped by edge status, origin status, and hostname. Use when Logpull is unavailable or to establish impact. Requires Analytics Read.",
      inputSchema: {
        zone_id: idSchema,
        start_utc: utcSchema,
        end_utc: utcSchema,
        hostname: z.string().min(1).max(253).optional(),
      },
    },
    async ({ zone_id, start_utc, end_utc, hostname }) =>
      toolResult({
        analytics: await client.getErrorAnalytics({
          zoneId: validateId(zone_id, "zone_id"),
          start: start_utc,
          end: end_utc,
          ...(hostname ? { hostname } : {}),
        }),
        notice:
          "Adaptive analytics may be sampled. Use request logs and origin evidence for request-level conclusions.",
      }),
  );

  server.registerTool(
    "get_recent_cloudflare_changes",
    {
      description:
        "Retrieve Cloudflare account audit events to identify configuration changes near an incident. Requires Account Settings Read.",
      inputSchema: {
        account_id: idSchema,
        start_utc: utcSchema,
        end_utc: utcSchema,
        zone_id: idSchema.optional(),
      },
    },
    async ({ account_id, start_utc, end_utc, zone_id }) =>
      toolResult({
        audit_events: await client.getAuditLogs({
          accountId: validateId(account_id, "account_id"),
          start: start_utc,
          end: end_utc,
          ...(zone_id
            ? { zoneId: validateId(zone_id, "zone_id") }
            : {}),
        }),
      }),
  );

  server.registerTool(
    "troubleshoot_http_issue",
    {
      description:
        "Run a read-only HTTP investigation across adaptive analytics, Enterprise Logpull, and optional audit logs. Returns partial results when a dataset or permission is unavailable.",
      inputSchema: {
        zone_id: idSchema,
        start_utc: utcSchema,
        end_utc: utcSchema,
        hostname: z.string().min(1).max(253).optional(),
        status_code: z.number().int().min(400).max(599).optional(),
        account_id: idSchema.optional(),
        log_limit: z.number().int().min(1).max(100).default(50),
      },
    },
    async ({
      zone_id,
      start_utc,
      end_utc,
      hostname,
      status_code,
      account_id,
      log_limit,
    }) => {
      validateLogWindow(start_utc, end_utc);
      const analyticsPromise = client.getErrorAnalytics({
        zoneId: zone_id,
        start: start_utc,
        end: end_utc,
        ...(hostname ? { hostname } : {}),
      });
      const logsPromise = client.getHttpLogs({
        zoneId: zone_id,
        start: start_utc,
        end: end_utc,
        limit: log_limit,
        includeQueryString: false,
        ...(hostname ? { hostname } : {}),
        ...(status_code !== undefined ? { statusCode: status_code } : {}),
      });
      const auditPromise = account_id
        ? client.getAuditLogs({
            accountId: account_id,
            start: start_utc,
            end: end_utc,
            zoneId: zone_id,
          })
        : Promise.resolve(undefined);

      const [analytics, logs, changes] = await Promise.allSettled([
        analyticsPromise,
        logsPromise,
        auditPromise,
      ]);
      const records = logs.status === "fulfilled" ? logs.value : [];

      return toolResult({
        likely_diagnoses: summarizeHttpErrors(records),
        analytics: settledValue(analytics),
        request_logs: settledValue(logs),
        recent_changes: settledValue(changes),
        evidence_needed: [
          "Origin and application logs matching the returned UTC timestamps",
          "Expected versus actual behavior and reproduction steps",
          "Business impact, affected users or regions, and incident frequency",
        ],
        conclusion:
          "These are likely fault domains, not a confirmed root cause. Correlate Ray IDs and UTC timestamps with origin evidence.",
      });
    },
  );

  return server;
}

function settledValue<T>(
  result: PromiseSettledResult<T>,
): { available: true; data: T } | { available: false; error: string } {
  return result.status === "fulfilled"
    ? { available: true, data: result.value }
    : { available: false, error: errorMessage(result.reason) };
}

function toolResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof CloudflareApiError) {
    if (error.status === 401 || error.status === 403) {
      return `${error.message}. Check that the token is active, scoped to this account/zone, and has the required read permission.`;
    }
    return error.message;
  }
  return error instanceof Error ? error.message : "Unknown error";
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": [
      "Content-Type",
      "Accept",
      "Mcp-Session-Id",
      "MCP-Protocol-Version",
      "Last-Event-ID",
      TOKEN_HEADER,
    ].join(", "),
    "Access-Control-Expose-Headers": "Mcp-Session-Id",
    "Access-Control-Max-Age": "86400",
  };
}

function withCors(response: Response): Response {
  const wrapped = new Response(response.body, response);
  for (const [name, value] of Object.entries(corsHeaders())) {
    wrapped.headers.set(name, value);
  }
  return wrapped;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (url.pathname === "/health") {
      return Response.json({
        status: "ok",
        service: "cloudflare-case-helper-mcp",
      });
    }

    if (url.pathname !== "/mcp") {
      return Response.json({
        name: "Cloudflare Troubleshooting MCP",
        endpoint: "/mcp",
        authentication:
          `Set ${TOKEN_HEADER} as a transport header. Never place a Cloudflare API token in a tool argument or chat message.`,
        permissions: [
          "Zone Read",
          "Analytics Read",
          "Logs Read (Enterprise Logpull)",
          "Account Settings Read (audit events)",
        ],
        documentation:
          "https://github.com/sycu8/Cloudflare-Case-Helpr#readme",
      });
    }

    const token = request.headers.get(TOKEN_HEADER)?.trim();
    if (!token) {
      return withCors(
        Response.json(
          {
            error: "missing_cloudflare_api_token",
            message:
              `Set ${TOKEN_HEADER} in the MCP transport headers. Do not send the token as a tool argument.`,
          },
          { status: 401 },
        ),
      );
    }

    try {
      const server = createServer(new CloudflareClient(token));
      const response = await createMcpHandler(server)(request, env, ctx);
      return withCors(response);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "mcp_request_failed",
          request_id: request.headers.get("cf-ray"),
          error: errorMessage(error),
        }),
      );
      return withCors(
        Response.json(
          { error: "request_failed", message: errorMessage(error) },
          { status: 500 },
        ),
      );
    }
  },
} satisfies ExportedHandler<Env>;
