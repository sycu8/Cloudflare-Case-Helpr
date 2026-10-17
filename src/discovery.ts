export const SERVER_NAME = "Cloudflare Troubleshooting";
export const SERVER_VERSION = "0.1.0";

/** Change this when a public document in SITEMAP_PATHS is added or rewritten. */
const SITEMAP_LASTMOD = "2026-10-17";
const SITEMAP_PATHS = ["/", "/auth.md"] as const;

const CONTENT_SIGNAL = "Content-Signal: ai-train=no, search=yes, ai-input=yes";
const PUBLIC_RULES = ["Allow: /", "Disallow: /api/", "Disallow: /mcp"];
const TRAINING_RULES = ["Disallow: /"];

const SEARCH_CRAWLERS = ["OAI-SearchBot", "Claude-SearchBot", "PerplexityBot"];
const TRAINING_CRAWLERS = [
  "GPTBot",
  "ClaudeBot",
  "Google-Extended",
  "Applebot-Extended",
  "CCBot",
  "Bytespider",
  "Amazonbot",
];
const USER_FETCHERS = ["ChatGPT-User", "Claude-User", "Perplexity-User"];

const TOKEN_PAGE = "https://dash.cloudflare.com/profile/api-tokens";

const MCP_TOOLS = [
  "check_cloudflare_connection",
  "analyze_issue_input",
  "get_required_case_evidence",
  "validate_support_case",
  "generate_support_case_draft",
  "list_cloudflare_accounts",
  "list_cloudflare_zones",
  "lookup_http_request_by_ray_id",
  "get_http_error_logs",
  "get_http_error_analytics",
  "get_recent_cloudflare_changes",
  "troubleshoot_http_issue",
] as const;

const SKILL_NAME = "cloudflare-support-case";

export const SUPPORT_CASE_SKILL = `---
name: cloudflare-support-case
description: Analyze a Cloudflare error and prepare a Support case with the read-only Case Helper HTTP API and MCP server. Use when a customer reports an HTTP error, Ray ID, hostname, or needs a case draft.
---

# Cloudflare support case

Use this skill to collect evidence and draft a Cloudflare Support case. The service is read-only. It does not submit the case or confirm a root cause.

## Authenticate

Protected calls need a customer Cloudflare API token. Create or revoke it at ${TOKEN_PAGE}. Send it only in the \`X-Cloudflare-API-Token\` header. Never put the token in a tool argument, query string, or \`Authorization\` header.

Grant only the permissions the task needs: Zone Read, Analytics Read, Logs Read, and Account Settings Read.

## MCP

Connect to \`/mcp\` with Streamable HTTP. Tool names:

${MCP_TOOLS.map((name) => `- \`${name}\``).join("\n")}

Start with \`check_cloudflare_connection\`, then \`analyze_issue_input\` or \`troubleshoot_http_issue\`. Keep log windows at or under one hour and inside the last seven days, in UTC, ending with \`Z\`.

## HTTP API

These routes do not need a token:

- \`POST /api/analyze\` with \`{ "message": "..." }\` for text. A screenshot data URL is optional and is sent to Workers AI.
- \`GET /api/evidence?issue_type=outage\` for the checklist. Types: outage, performance, dns, ssl, security, workers, zero-trust, other.
- \`POST /api/case/validate\` and \`POST /api/case/draft\` with the case fields.
- \`GET /health\` for status.

Account routes (\`/api/cloudflare/connection\`, \`/accounts\`, \`/zones\`) use the same token header.

## Case fields

Include priority, zone or hostname, UTC start, impact, frequency, expected behavior, actual behavior, reproduction steps, and an exact error, Ray ID, or attachment. P1 also needs the Cloudflare service, affected users, and origin investigation status. Do not include passwords, API keys, private keys, cookies, or payment data.

## Discovery

- API catalog: \`/.well-known/api-catalog\`
- OpenAPI: \`/.well-known/openapi.json\`
- MCP server card: \`/.well-known/mcp/server-card.json\`
- Auth instructions: \`/auth.md\`
`;

export function withHomepageLinks(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.append("Link", homepageLinkHeader());
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function homepageLinkHeader(): string {
  return [
    '</.well-known/api-catalog>; rel="api-catalog"',
    '</.well-known/openapi.json>; rel="service-desc"; type="application/openapi+json"',
    '</auth.md>; rel="service-doc"; type="text/markdown"',
    '</.well-known/mcp/server-card.json>; rel="describedby"; type="application/json"',
    '</.well-known/ai-catalog.json>; rel="describedby"; type="application/json"',
    '</.well-known/agent-skills/index.json>; rel="describedby"; type="application/json"',
  ].join(", ");
}

export function protectedResourceChallenge(origin: string): string {
  return [
    'Bearer realm="cloudflare-case-helper"',
    `resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
    'error="invalid_request"',
    `error_description="Set the X-Cloudflare-API-Token header to a read-only Cloudflare API token. See ${origin}/auth.md."`,
  ].join(", ");
}

export async function handleDiscovery(
  request: Request,
): Promise<Response | null> {
  const url = new URL(request.url);
  const origin = url.origin;

  if (url.pathname === "/oauth/token" || url.pathname === "/oauth/authorize") {
    if (!["GET", "POST", "HEAD"].includes(request.method)) {
      return methodNotAllowed("GET, POST, HEAD");
    }
    return oauthUnavailable(origin, request.method === "HEAD");
  }

  const document = await discoveryDocument(url.pathname, origin);
  if (!document) return null;
  if (request.method !== "GET" && request.method !== "HEAD") {
    return methodNotAllowed("GET, HEAD");
  }
  return new Response(request.method === "HEAD" ? null : document.body, {
    status: 200,
    headers: document.headers,
  });
}

async function discoveryDocument(
  pathname: string,
  origin: string,
): Promise<{ body: string; headers: Headers } | null> {
  switch (pathname) {
    case "/robots.txt":
      return textDocument(robotsTxt(origin), "text/plain; charset=utf-8");
    case "/sitemap.xml":
      return textDocument(sitemapXml(origin), "application/xml; charset=utf-8");
    case "/auth.md":
      return textDocument(authMd(origin), "text/markdown; charset=utf-8");
    case "/.well-known/api-catalog":
      return textDocument(
        JSON.stringify(apiCatalog(origin)),
        'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"',
        { Link: '</.well-known/api-catalog>; rel="api-catalog"' },
      );
    case "/.well-known/openapi.json":
      return jsonDocument(openApi(origin), "application/openapi+json");
    case "/.well-known/oauth-authorization-server":
      return jsonDocument(authorizationServer(origin));
    case "/.well-known/openid-configuration":
      return jsonDocument({
        ...authorizationServer(origin),
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["none"],
      });
    case "/.well-known/oauth-protected-resource":
      return jsonDocument(protectedResource(origin));
    case "/.well-known/jwks.json":
      return jsonDocument({ keys: [] });
    case "/.well-known/mcp/server-card.json":
      return jsonDocument(serverCard(origin));
    case "/.well-known/agent-skills/index.json":
      return jsonDocument(await skillsIndex(origin));
    case `/.well-known/agent-skills/${SKILL_NAME}/SKILL.md`:
      return textDocument(SUPPORT_CASE_SKILL, "text/markdown; charset=utf-8");
    case "/.well-known/ai-catalog.json":
      return jsonDocument(aiCatalog(origin));
    default:
      return null;
  }
}

function robotsTxt(origin: string): string {
  const groups = [
    ...SEARCH_CRAWLERS.map((agent) => agentGroup(agent, PUBLIC_RULES)),
    ...TRAINING_CRAWLERS.map((agent) => agentGroup(agent, TRAINING_RULES)),
    ...USER_FETCHERS.map((agent) => agentGroup(agent, PUBLIC_RULES)),
    agentGroup("*", PUBLIC_RULES),
  ];
  return [
    "# Cloudflare Support Case Helper",
    "# Search and user-triggered fetchers may read public pages.",
    "# Training crawlers may not. /api/ and /mcp are not documents.",
    "",
    ...groups,
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    `Agentmap: ${origin}/.well-known/ai-catalog.json`,
    "",
  ].join("\n");
}

function agentGroup(agent: string, rules: string[]): string {
  return [`User-agent: ${agent}`, CONTENT_SIGNAL, ...rules, ""].join("\n");
}

function sitemapXml(origin: string): string {
  const urls = SITEMAP_PATHS.map(
    (path) => `  <url>
    <loc>${xmlEscape(`${origin}${path}`)}</loc>
    <lastmod>${SITEMAP_LASTMOD}</lastmod>
  </url>`,
  ).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

function authMd(origin: string): string {
  return `# auth.md

You are an agent. This service does not register agent accounts and does not mint OAuth access tokens. A person creates a Cloudflare API token, and you send that token on protected requests.

## Audience

Agents helping a Cloudflare customer collect read-only evidence and draft a Support case. There is no end-user login on this origin.

## Registration and credentials

Create, roll, or revoke the token at ${TOKEN_PAGE}. That page is the registration, claim, and revocation URL advertised in \`/.well-known/oauth-authorization-server\`.

Supported identity type: \`anonymous\`. Supported credential type: \`api_key\` (a Cloudflare API token). No identity assertion, verified-email ceremony, or anonymous claim code is issued here.

Send the token in this header:

\`\`\`http
X-Cloudflare-API-Token: <cloudflare-api-token>
\`\`\`

Do not place the token in a tool argument, a query string, or the \`Authorization\` header. \`Authorization\` is reserved for an edge access policy if the operator adds one later.

Enable only the permissions the task needs:

- Zone Read, to list zones
- Analytics Read, for aggregated HTTP errors
- Logs Read, for Enterprise Logpull and Ray ID lookup
- Account Settings Read, for accounts and audit events

## Protected resources

Resource identifier: \`${origin}\`

Protected paths under that resource:

- \`/mcp\` — Streamable HTTP MCP
- \`GET /api/cloudflare/connection\`
- \`GET /api/cloudflare/accounts\`
- \`GET /api/cloudflare/zones\`

A missing token returns HTTP 401 and \`WWW-Authenticate\` with \`resource_metadata="${origin}/.well-known/oauth-protected-resource"\`.

\`POST ${origin}/oauth/token\` and \`GET ${origin}/oauth/authorize\` do not issue tokens. They return HTTP 400. Do not send client secrets to them.

## Calling the API

Public routes need no token: \`POST /api/analyze\`, \`GET /api/evidence\`, \`POST /api/case/validate\`, \`POST /api/case/draft\`, and \`GET /health\`.

Read the machine-readable description at \`${origin}/.well-known/openapi.json\` and the MCP card at \`${origin}/.well-known/mcp/server-card.json\`.

Keep findings labeled as likely fault domains. Correlate Ray IDs and UTC timestamps with origin logs before treating them as a root cause. Never send passwords, private keys, cookies, or payment data.
`;
}

function apiCatalog(origin: string) {
  const description = {
    href: `${origin}/.well-known/openapi.json`,
    type: "application/openapi+json",
  };
  const documentation = {
    href: `${origin}/auth.md`,
    type: "text/markdown",
  };
  const status = {
    href: `${origin}/health`,
    type: "application/json",
  };
  return {
    linkset: [
      {
        anchor: `${origin}/api`,
        "service-desc": [description],
        "service-doc": [documentation],
        status: [status],
      },
      {
        anchor: `${origin}/mcp`,
        "service-desc": [
          {
            href: `${origin}/.well-known/mcp/server-card.json`,
            type: "application/json",
          },
        ],
        "service-doc": [documentation],
        status: [status],
      },
    ],
  };
}

function openApi(origin: string) {
  const caseSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      priority: { type: "string", enum: ["P1", "P2", "P3", "P4"] },
      service: { type: "string" },
      issueType: {
        type: "string",
        enum: [
          "outage",
          "performance",
          "dns",
          "ssl",
          "security",
          "workers",
          "zero-trust",
          "other",
        ],
      },
      zoneName: { type: "string" },
      zoneId: { type: "string" },
      hostnames: { type: "string" },
      startedUtc: { type: "string" },
      frequency: { type: "string" },
      impact: { type: "string" },
      affectedUsers: { type: "string" },
      expected: { type: "string" },
      actual: { type: "string" },
      reproduction: { type: "string" },
      exampleUrls: { type: "string" },
      exactErrors: { type: "string" },
      rayIds: { type: "string" },
      recentChanges: { type: "string" },
      originFindings: { type: "string" },
      attachments: { type: "string" },
      participants: { type: "string" },
    },
  };
  const json = { "application/json": { schema: { type: "object" } } };
  return {
    openapi: "3.1.0",
    info: {
      title: "Cloudflare Support Case Helper API",
      version: SERVER_VERSION,
      description:
        "Read-only issue analysis, evidence checklists, and Support case drafts. Account routes need a Cloudflare API token in the X-Cloudflare-API-Token header.",
    },
    servers: [{ url: origin }],
    components: {
      securitySchemes: {
        cloudflareApiToken: {
          type: "apiKey",
          in: "header",
          name: "X-Cloudflare-API-Token",
        },
      },
      schemas: { SupportCase: caseSchema },
    },
    paths: {
      "/health": {
        get: {
          operationId: "getHealth",
          responses: { "200": { description: "Service health", content: json } },
        },
      },
      "/api/analyze": {
        post: {
          operationId: "analyzeIssue",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    message: { type: "string" },
                    imageDataUrl: { type: "string" },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Likely issue", content: json } },
        },
      },
      "/api/evidence": {
        get: {
          operationId: "getEvidence",
          parameters: [
            {
              name: "issue_type",
              in: "query",
              schema: { type: "string" },
            },
          ],
          responses: { "200": { description: "Evidence checklist", content: json } },
        },
      },
      "/api/case/validate": {
        post: {
          operationId: "validateCase",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SupportCase" },
              },
            },
          },
          responses: { "200": { description: "Validation result", content: json } },
        },
      },
      "/api/case/draft": {
        post: {
          operationId: "draftCase",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SupportCase" },
              },
            },
          },
          responses: { "200": { description: "Case draft", content: json } },
        },
      },
      "/api/cloudflare/zones": {
        get: {
          operationId: "listZones",
          security: [{ cloudflareApiToken: [] }],
          responses: { "200": { description: "Visible zones", content: json } },
        },
      },
      "/mcp": {
        post: {
          operationId: "mcp",
          description:
            "Streamable HTTP MCP. Requires X-Cloudflare-API-Token. See the server card for tool names.",
          security: [{ cloudflareApiToken: [] }],
          responses: {
            "200": { description: "MCP response" },
            "401": { description: "Missing Cloudflare API token" },
          },
        },
      },
    },
  };
}

function authorizationServer(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    jwks_uri: `${origin}/.well-known/jwks.json`,
    registration_endpoint: TOKEN_PAGE,
    revocation_endpoint: TOKEN_PAGE,
    response_types_supported: ["none"],
    grant_types_supported: ["urn:cloudflare:params:oauth:grant-type:api-token"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: protectedScopes(),
    service_documentation: `${origin}/auth.md`,
    agent_auth: {
      skill: `${origin}/auth.md`,
      register_uri: TOKEN_PAGE,
      claim_uri: TOKEN_PAGE,
      revocation_uri: TOKEN_PAGE,
      identity_types_supported: ["anonymous"],
      anonymous: {
        credential_types_supported: ["api_key"],
        claim_uri: TOKEN_PAGE,
      },
    },
  };
}

function protectedResource(origin: string) {
  return {
    resource: origin,
    resource_name: "Cloudflare Support Case Helper",
    authorization_servers: [origin],
    scopes_supported: protectedScopes(),
    bearer_methods_supported: ["header"],
    resource_documentation: `${origin}/auth.md`,
  };
}

function protectedScopes(): string[] {
  return [
    "zone:read",
    "analytics:read",
    "logs:read",
    "account-settings:read",
  ];
}

function serverCard(origin: string) {
  return {
    serverInfo: {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    description:
      "Read-only Cloudflare evidence collection and Support case drafting over Streamable HTTP.",
    transport: {
      type: "streamable-http",
      endpoint: `${origin}/mcp`,
    },
    capabilities: {
      tools: { listChanged: false },
    },
    tools: MCP_TOOLS.map((name) => ({ name })),
    authentication: {
      required: true,
      header: "X-Cloudflare-API-Token",
      documentation: `${origin}/auth.md`,
    },
  };
}

async function skillsIndex(origin: string) {
  const digest = await sha256Digest(SUPPORT_CASE_SKILL);
  return {
    $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
    skills: [
      {
        name: SKILL_NAME,
        type: "skill-md",
        description:
          "Analyze a Cloudflare error and prepare a Support case with the read-only Case Helper HTTP API and MCP server.",
        url: `${origin}/.well-known/agent-skills/${SKILL_NAME}/SKILL.md`,
        digest,
      },
    ],
  };
}

function aiCatalog(origin: string) {
  const host = new URL(origin).hostname;
  return {
    specVersion: "1.0",
    host: {
      displayName: "Cloudflare Support Case Helper",
      identifier: `did:web:${host}`,
    },
    entries: [
      {
        identifier: `urn:air:${host}:server:cloudflare-troubleshooting`,
        displayName: "Cloudflare Troubleshooting MCP server",
        type: "application/mcp-server-card+json",
        url: `${origin}/.well-known/mcp/server-card.json`,
        representativeQueries: [
          "Look up this Cloudflare Ray ID in the zone request logs",
          "What HTTP 5xx errors hit this hostname in the last hour?",
          "Which account changes happened around this Cloudflare outage?",
          "Draft a Cloudflare Support case for error 522",
        ],
      },
      {
        identifier: `urn:air:${host}:api:support-case`,
        displayName: "Support case HTTP API",
        type: "application/openapi+json",
        url: `${origin}/.well-known/openapi.json`,
        representativeQueries: [
          "Analyze this Cloudflare error message",
          "What evidence does a P1 Cloudflare support case need?",
          "Validate my support case before I copy it into the dashboard",
        ],
      },
      {
        identifier: `urn:air:${host}:skill:cloudflare-support-case`,
        displayName: "Cloudflare support case skill",
        type: "text/markdown",
        url: `${origin}/.well-known/agent-skills/${SKILL_NAME}/SKILL.md`,
        representativeQueries: [
          "How do I connect an agent to the Cloudflare troubleshooting server?",
          "Which header carries the read-only Cloudflare API token?",
        ],
      },
      {
        identifier: `urn:air:${host}:catalog:http-api`,
        displayName: "HTTP and MCP API catalog",
        type: "application/linkset+json",
        url: `${origin}/.well-known/api-catalog`,
        representativeQueries: [
          "Where is the OpenAPI description for the support case API?",
          "What is the health endpoint for this service?",
        ],
      },
    ],
  };
}

function oauthUnavailable(origin: string, head: boolean): Response {
  const body = {
    error: "unsupported_grant_type",
    error_description: `This service does not mint access tokens. Create a read-only Cloudflare API token at ${TOKEN_PAGE} and send it in the X-Cloudflare-API-Token header. See ${origin}/auth.md.`,
  };
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "X-Content-Type-Options": "nosniff",
  });
  return new Response(head ? null : JSON.stringify(body), {
    status: 400,
    headers,
  });
}

function jsonDocument(
  value: unknown,
  contentType = "application/json; charset=utf-8",
): { body: string; headers: Headers } {
  return textDocument(JSON.stringify(value), contentType);
}

function textDocument(
  body: string,
  contentType: string,
  extra?: Record<string, string>,
): { body: string; headers: Headers } {
  const headers = new Headers({
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=300",
    "Access-Control-Allow-Origin": "*",
    "X-Content-Type-Options": "nosniff",
  });
  if (extra) {
    for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  }
  return { body, headers };
}

function methodNotAllowed(allow: string): Response {
  return new Response("Method not allowed\n", {
    status: 405,
    headers: {
      Allow: allow,
      "Content-Type": "text/plain; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

async function sha256Digest(text: string): Promise<string> {
  const encoded = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `sha256:${hex}`;
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
