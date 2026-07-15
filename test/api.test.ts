import { describe, expect, it } from "vitest";

import { handleApi } from "../src/api";

const env = {
  AI: {} as Ai,
  ASSETS: {} as Fetcher,
} satisfies Env;

describe("browser API", () => {
  it("analyzes text without invoking Workers AI", async () => {
    const response = await handleApi(
      new Request("https://example.test/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message:
            "Cloudflare Error 1020, Ray ID 49ddb3e70e665831 at 2026-07-15T03:32:00Z",
        }),
      }),
      env,
    );
    const result = await response.json<{
      likelyIssue: string;
      aiUsed: boolean;
    }>();

    expect(response.status).toBe(200);
    expect(result).toMatchObject({
      likelyIssue: "Request blocked by a Cloudflare rule (1020)",
      aiUsed: false,
    });
  });

  it("generates a copy-ready case draft", async () => {
    const response = await handleApi(
      new Request("https://example.test/api/case/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          priority: "P2",
          zoneName: "example.com",
          startedUtc: "2026-07-15T03:32:00Z",
          impact: "Checkout is unavailable",
          frequency: "Every request",
          expected: "Checkout succeeds",
          actual: "Requests return 522",
          reproduction: "Open the checkout URL",
          exactErrors: "Error 522",
        }),
      }),
      env,
    );
    const result = await response.json<{
      body: string;
      validation: { ready: boolean };
    }>();

    expect(response.status).toBe(200);
    expect(result.validation.ready).toBe(true);
    expect(result.body).toContain("Title: P2 Cloudflare");
    expect(result.body).toContain("Zone name: example.com");
  });

  it("rejects account connections without a transport token", async () => {
    const response = await handleApi(
      new Request("https://example.test/api/cloudflare/connection"),
      env,
    );

    expect(response.status).toBe(401);
  });
});
