# Cloudflare Troubleshooting MCP

A read-only Model Context Protocol server for collecting Cloudflare evidence
before opening a Support case. It runs on Cloudflare Workers using Streamable
HTTP at `/mcp`.

The server can:

- verify a customer-provided API token;
- list accessible accounts and zones;
- retrieve an HTTP request by Ray ID through Enterprise Logpull;
- retrieve a bounded HTTP log sample and explain common 520–526 errors;
- aggregate 4xx/5xx traffic through the GraphQL Analytics API;
- correlate incidents with account audit events; and
- run a combined investigation while returning partial results when a dataset
  or permission is unavailable.

Results are likely troubleshooting findings, not confirmed root causes.
Customers should correlate Ray IDs and UTC timestamps with origin and
application logs.

## Security model

Supply a least-privilege Cloudflare API token in the
`X-Cloudflare-API-Token` MCP **transport header**. Never paste a token into a
chat message or pass it as a tool argument.

The Worker:

- keeps no customer token or log data in storage;
- never returns the token in a tool response;
- sends the token only to `api.cloudflare.com`;
- removes URL query strings from request logs by default;
- does not request client IP or cookie fields;
- limits Logpull responses to 100 records and 1 MB; and
- exposes read-only tools only.

For a shared production service, protect `/mcp` separately with Cloudflare
Access or an OAuth provider. Reserve the standard `Authorization` header for
that service authentication; this project deliberately uses a separate header
for the downstream Cloudflare API token. A customer that does not trust the
service operator should self-host the Worker.

## API token permissions

Create a token scoped only to the accounts and zones being investigated.
Enable only the permissions needed:

| Capability | Permission |
| --- | --- |
| List zones | Zone Read |
| Aggregated HTTP errors | Analytics Read |
| HTTP request logs and Ray ID lookup | Logs Read |
| Account audit events | Account Settings Read |

Logpull is an Enterprise feature. GraphQL analytics remains useful when
request logs are unavailable. Product availability and retention depend on the
customer plan.

Do not use a Global API key.

## Tools

| Tool | Purpose |
| --- | --- |
| `check_cloudflare_connection` | Verify the connected token |
| `list_cloudflare_accounts` | Find accessible account IDs |
| `list_cloudflare_zones` | Find accessible zone IDs |
| `lookup_http_request_by_ray_id` | Correlate one request |
| `get_http_error_logs` | Retrieve and classify a bounded log sample |
| `get_http_error_analytics` | Measure 4xx/5xx impact |
| `get_recent_cloudflare_changes` | Find changes near an incident |
| `troubleshoot_http_issue` | Run analytics, Logpull, and audit correlation |

## Local development

Requirements: Node.js 18 or newer and a Cloudflare account.

```bash
npm install
npm run dev
```

The MCP endpoint is normally `http://localhost:8787/mcp`. Configure an MCP
client that supports Streamable HTTP and custom headers:

```ts
await client.addMcpServer(
  "cloudflare-troubleshooting",
  "http://localhost:8787/mcp",
  {
    transport: {
      type: "streamable-http",
      headers: {
        "X-Cloudflare-API-Token": process.env.CLOUDFLARE_API_TOKEN!,
      },
    },
  },
);
```

Confirm extracted account and zone IDs before querying logs. Keep incident
windows narrow and in UTC.

## Validate and deploy

```bash
npm run check
npm run deploy
```

The deployment exposes:

- `/mcp` — authenticated Streamable HTTP MCP endpoint;
- `/health` — health check with no customer data; and
- `/` — service metadata and required permissions.

## Current scope

This initial implementation focuses on HTTP traffic, Logpull, GraphQL
analytics, and audit events. Workers stored logs are not queried by this
server. Add a separate connector for the official Workers Observability MCP or
for a customer-controlled Logpush/OTel destination rather than claiming those
logs are available through Logpull.

Cloudflare Support guidance:
https://developers.cloudflare.com/support/contacting-cloudflare-support/
