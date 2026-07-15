# Cloudflare Support Case Helper

A responsive troubleshooting application and read-only MCP server for
collecting Cloudflare evidence and preparing a complete Support case. It runs
on Cloudflare Workers with Static Assets, Workers AI, and Streamable HTTP MCP.

The browser application can:

- analyze error descriptions locally and screenshots uploaded or pasted
  directly into the chat with Workers AI;
- identify common Cloudflare errors, Ray IDs, hostnames, and UTC timestamps;
- conduct a local adaptive chat that asks only for missing minimum case fields;
- request custom impacted service names when the customer selects **Other**;
- show Cloudflare and origin evidence-collection guidance with each question;
- accept conversational incident times and normalize them to UTC for log
  correlation;
- increase requirements automatically for P1 critical incidents;
- warn about possible secrets and unsupported P1 priority;
- store chat, answers, and drafts only in the customer's browser;
- generate the copy-ready Support case locally without sending answers to the
  server;
- translate generated drafts into English, Vietnamese, or Khmer while
  preserving technical identifiers; and
- switch the full website interface from the persistent language menu, with
  translated UI content cached locally by language and content version.

The MCP server can:

- perform the same issue analysis, evidence checklist, validation, and drafting;
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

- keeps no customer token, screenshot, draft, or log data in server-side storage;
- does not receive normal chat answers or locally generated case drafts;
- never returns the token in a tool response;
- sends the token only to `api.cloudflare.com`;
- sends screenshots only to the configured Workers AI binding for the requested
  analysis and sends draft content only when the customer explicitly requests
  translation;
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
| `analyze_issue_input` | Identify errors and troubleshooting signals |
| `get_required_case_evidence` | Build an issue-specific evidence checklist |
| `validate_support_case` | Report missing details and safety warnings |
| `generate_support_case_draft` | Create a copy-ready support case |
| `list_cloudflare_accounts` | Find accessible account IDs |
| `list_cloudflare_zones` | Find accessible zone IDs |
| `lookup_http_request_by_ray_id` | Correlate one request |
| `get_http_error_logs` | Retrieve and classify a bounded log sample |
| `get_http_error_analytics` | Measure 4xx/5xx impact |
| `get_recent_cloudflare_changes` | Find changes near an incident |
| `troubleshoot_http_issue` | Run analytics, Logpull, and audit correlation |

## Local development

Requirements: Node.js 22.18 or newer and a Cloudflare account.

```bash
npm install
npm run dev
```

The browser application is normally available at `http://localhost:8787`, and
the MCP endpoint is at `http://localhost:8787/mcp`. The Workers AI binding uses
a remote Cloudflare development connection for screenshot analysis.

Configure an MCP client that supports Streamable HTTP and custom headers:

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

First authenticate the deployment environment using one of these methods:

### Wrangler login

```bash
npx wrangler login
npx wrangler whoami
```

### CI or Cloud Agent

Set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as protected
environment secrets. Create a separate deployment token using Cloudflare's
**Edit Cloudflare Workers** API token template and scope it to the deployment
account. Do not reuse a customer's troubleshooting token for deployment.

The included `.github/workflows/deploy.yml` workflow verifies and deploys the
application when changes reach `main`. It also supports manual runs from the
GitHub Actions page.

When deploying from a Cursor Cloud Agent, you can instead authenticate the
`Cloudflare-builds` MCP integration from the agent's **MCP** menu. Cursor IDE
authentication under **Settings → Tools & MCP** is separate from Cloud Agent
authentication.

Verify and deploy:

```bash
npm run check
npm run deploy
```

`wrangler deploy --temporary` creates a temporary preview and is not a
production deployment for this application.

The deployment exposes:

- `/mcp` — authenticated Streamable HTTP MCP endpoint;
- `/api/analyze` — rules-first text and Workers AI screenshot analysis;
- `/api/translate` — English, Vietnamese, and Khmer case translation;
- `/api/translate-ui` — ordered website-interface translation for local caching;
- `/api/evidence` — adaptive evidence requirements;
- `/api/case/*` — validation and draft generation;
- `/api/cloudflare/*` — in-memory customer account connection;
- `/health` — health check with no customer data; and
- `/` — responsive customer application.

Before offering the application as a public shared service, add Cloudflare
Turnstile and rate limiting to the screenshot-analysis endpoint, and protect
the MCP endpoint with Cloudflare Access or OAuth.

## Current scope

This initial implementation focuses on HTTP traffic, Logpull, GraphQL
analytics, and audit events. Workers stored logs are not queried by this
server. Add a separate connector for the official Workers Observability MCP or
for a customer-controlled Logpush/OTel destination rather than claiming those
logs are available through Logpull.

Cloudflare Support guidance:
https://developers.cloudflare.com/support/contacting-cloudflare-support/
