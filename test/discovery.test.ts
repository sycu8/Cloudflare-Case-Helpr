import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  SUPPORT_CASE_SKILL,
  handleDiscovery,
  protectedResourceChallenge,
  withHomepageLinks,
} from "../src/discovery";

const origin = "https://case-helper.example";

async function get(path: string, method = "GET"): Promise<Response> {
  const response = await handleDiscovery(
    new Request(`${origin}${path}`, { method }),
  );
  if (!response) throw new Error(`No discovery document for ${path}`);
  return response;
}

describe("agent discovery", () => {
  it("serves robots.txt as plain text with crawler policy and a sitemap", async () => {
    const response = await get("/robots.txt");
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/plain");
    expect(body).toContain(`Sitemap: ${origin}/sitemap.xml`);
    expect(body).toContain(`Agentmap: ${origin}/.well-known/ai-catalog.json`);

    const groups = body
      .split(/\n(?=User-agent: )/)
      .filter((group) => group.startsWith("User-agent:"));
    const byAgent = new Map(
      groups.map((group) => [group.split("\n")[0]?.replace("User-agent: ", ""), group]),
    );

    for (const agent of ["OAI-SearchBot", "Claude-SearchBot", "PerplexityBot", "*"]) {
      const group = byAgent.get(agent);
      expect(group).toContain("Content-Signal: ai-train=no, search=yes, ai-input=yes");
      expect(group).toContain("Allow: /");
      expect(group).toContain("Disallow: /api/");
      expect(group).toContain("Disallow: /mcp");
    }
    for (const agent of [
      "GPTBot",
      "ClaudeBot",
      "Google-Extended",
      "Applebot-Extended",
      "CCBot",
      "Bytespider",
      "Amazonbot",
    ]) {
      const group = byAgent.get(agent);
      expect(group).toContain("Content-Signal: ai-train=no, search=yes, ai-input=yes");
      expect(group).toContain("Disallow: /");
      expect(group).not.toContain("Allow: /");
    }
    for (const agent of ["ChatGPT-User", "Claude-User", "Perplexity-User"]) {
      expect(byAgent.get(agent)).toContain("Allow: /");
    }
  });

  it("lists canonical public URLs in sitemap.xml", async () => {
    const response = await get("/sitemap.xml");
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/xml");
    expect(body).toContain("<loc>https://case-helper.example/</loc>");
    expect(body).toContain("<loc>https://case-helper.example/auth.md</loc>");
    expect(body).toContain("<lastmod>2026-10-17</lastmod>");
  });

  it("adds Link headers on the homepage", async () => {
    const asset = new Response("<!doctype html><title>Case Helper</title>", {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
    const response = withHomepageLinks(asset);
    const link = response.headers.get("Link") ?? "";

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Case Helper");
    expect(link).toContain('</.well-known/api-catalog>; rel="api-catalog"');
    expect(link).toContain('rel="service-desc"');
    expect(link).toContain('rel="service-doc"');
    expect(link).toContain('rel="describedby"');
    expect(await handleDiscovery(new Request(`${origin}/`))).toBeNull();
  });

  it("publishes an RFC 9727 API catalog", async () => {
    const response = await get("/.well-known/api-catalog");
    const body = await response.json<{
      linkset: Array<{
        anchor: string;
        "service-desc": Array<{ href: string }>;
        "service-doc": Array<{ href: string }>;
        status: Array<{ href: string }>;
      }>;
    }>();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/linkset+json");
    expect(body.linkset).toHaveLength(2);
    for (const entry of body.linkset) {
      expect(entry.anchor.startsWith(origin)).toBe(true);
      expect(entry["service-desc"][0]?.href).toMatch(/^https:\/\//);
      expect(entry["service-doc"][0]?.href).toBe(`${origin}/auth.md`);
      expect(entry.status[0]?.href).toBe(`${origin}/health`);
    }
  });

  it("publishes OAuth metadata that matches the protected resource", async () => {
    const metadata = await get("/.well-known/oauth-authorization-server");
    const oidc = await get("/.well-known/openid-configuration");
    const resource = await get("/.well-known/oauth-protected-resource");
    const jwks = await get("/.well-known/jwks.json");
    const asBody = await metadata.json<{
      issuer: string;
      authorization_endpoint: string;
      token_endpoint: string;
      jwks_uri: string;
      grant_types_supported: string[];
      response_types_supported: string[];
      agent_auth: {
        skill: string;
        register_uri: string;
        identity_types_supported: string[];
        anonymous: { credential_types_supported: string[]; claim_uri: string };
      };
    }>();
    const resourceBody = await resource.json<{
      resource: string;
      authorization_servers: string[];
      scopes_supported: string[];
      bearer_methods_supported: string[];
    }>();

    expect(metadata.status).toBe(200);
    expect(oidc.status).toBe(200);
    expect(resource.status).toBe(200);
    expect(asBody.issuer).toBe(origin);
    expect(resourceBody.authorization_servers).toEqual([asBody.issuer]);
    expect(resourceBody.resource).toBe(`${origin}/mcp`);
    expect(resourceBody.bearer_methods_supported).toContain("header");
    expect(resourceBody.scopes_supported.length).toBeGreaterThan(0);
    expect(asBody.authorization_endpoint).toBe(`${origin}/oauth/authorize`);
    expect(asBody.token_endpoint).toBe(`${origin}/oauth/token`);
    expect(asBody.jwks_uri).toBe(`${origin}/.well-known/jwks.json`);
    expect(asBody.grant_types_supported.length).toBeGreaterThan(0);
    expect(asBody.response_types_supported.length).toBeGreaterThan(0);
    expect(asBody.agent_auth.skill).toBe(`${origin}/auth.md`);
    expect(asBody.agent_auth.register_uri).toMatch(/^https:\/\//);
    expect(asBody.agent_auth.identity_types_supported).toEqual(["anonymous"]);
    expect(asBody.agent_auth.anonymous.credential_types_supported).toEqual([
      "api_key",
    ]);
    expect(asBody.agent_auth.anonymous.claim_uri).toMatch(/^https:\/\//);
    expect(await jwks.json()).toEqual({ keys: [] });

    const token = await get("/oauth/token", "POST");
    const tokenBody = await token.json<{ access_token?: string; error: string }>();
    expect(token.status).toBe(400);
    expect(tokenBody.error).toBe("unsupported_grant_type");
    expect(tokenBody.access_token).toBeUndefined();
  });

  it("serves auth.md with an auth.md heading", async () => {
    const response = await get("/auth.md");
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/markdown");
    expect(body.startsWith("# auth.md\n")).toBe(true);
    expect(body).toContain("X-Cloudflare-API-Token");
  });

  it("serves an MCP server card", async () => {
    const response = await get("/.well-known/mcp/server-card.json");
    const body = await response.json<{
      serverInfo: { name: string; version: string };
      transport: { endpoint: string };
      capabilities: { tools: object };
    }>();

    expect(response.status).toBe(200);
    expect(body.serverInfo).toEqual({
      name: "Cloudflare Troubleshooting",
      version: "0.1.0",
    });
    expect(body.transport.endpoint).toBe(`${origin}/mcp`);
    expect(body.capabilities.tools).toBeTypeOf("object");
  });

  it("serves a skills index whose digest matches the skill bytes", async () => {
    const response = await get("/.well-known/agent-skills/index.json");
    const skill = await get(
      "/.well-known/agent-skills/cloudflare-support-case/SKILL.md",
    );
    const body = await response.json<{
      $schema: string;
      skills: Array<{
        name: string;
        type: string;
        description: string;
        url: string;
        digest: string;
      }>;
    }>();
    const skillBody = await skill.text();
    const expected = `sha256:${createHash("sha256").update(skillBody).digest("hex")}`;

    expect(response.status).toBe(200);
    expect(body.$schema).toBe(
      "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
    );
    expect(body.skills).toHaveLength(1);
    expect(body.skills[0]).toMatchObject({
      name: "cloudflare-support-case",
      type: "skill-md",
      url: `${origin}/.well-known/agent-skills/cloudflare-support-case/SKILL.md`,
      digest: expected,
    });
    expect(skillBody).toBe(SUPPORT_CASE_SKILL);
    expect(body.skills[0]?.description.length).toBeGreaterThan(0);
  });

  it("serves an ARD catalog other origins can read", async () => {
    const response = await get("/.well-known/ai-catalog.json");
    const body = await response.json<{
      specVersion: string;
      host: { displayName: string; identifier: string };
      entries: Array<{
        identifier: string;
        displayName: string;
        type: string;
        url?: string;
        data?: unknown;
        representativeQueries: string[];
      }>;
    }>();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(body.specVersion).toBe("1.0");
    expect(body.host.displayName.length).toBeGreaterThan(0);
    expect(body.host.identifier).toBe("did:web:case-helper.example");
    expect(body.entries.length).toBeGreaterThan(0);
    for (const entry of body.entries) {
      expect(entry.identifier).toMatch(
        /^urn:air:case-helper\.example:[^:]+:[^:]+$/,
      );
      expect(entry.displayName.length).toBeGreaterThan(0);
      expect(entry.type).toContain("/");
      expect(Boolean(entry.url)).not.toBe(Boolean(entry.data));
      expect(entry.representativeQueries.length).toBeGreaterThanOrEqual(2);
      expect(entry.representativeQueries.length).toBeLessThanOrEqual(5);
    }
  });

  it("names protected-resource metadata in the MCP challenge", () => {
    expect(protectedResourceChallenge(origin)).toContain(
      `resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
    );
    expect(protectedResourceChallenge(origin)).toContain("X-Cloudflare-API-Token");
  });

  it("rejects unsupported methods on robots.txt", async () => {
    const response = await get("/robots.txt", "POST");
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toContain("GET");
  });
});
