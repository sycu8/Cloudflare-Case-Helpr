import { describe, expect, it, vi } from "vitest";

import { CloudflareApiError, CloudflareClient } from "../src/cloudflare";

describe("CloudflareClient", () => {
  it("sends the token only as a bearer header", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        success: true,
        result: { status: "active" },
      }),
    );
    const client = new CloudflareClient("secret-token", fetcher);

    await client.verifyToken();

    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://api.cloudflare.com/client/v4/user/tokens/verify",
    );
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      "Bearer secret-token",
    );
    expect(String(url)).not.toContain("secret-token");
  });

  it("removes query strings from Logpull records by default", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        `${JSON.stringify({
          RayID: "49ddb3e70e665831",
          ClientRequestURI: "/checkout?token=sensitive",
          EdgeResponseStatus: 522,
        })}\n`,
        { status: 200 },
      ),
    );
    const client = new CloudflareClient("secret-token", fetcher);

    const records = await client.lookupRayId(
      "023e105f4ecef8ad9ca31a8372d0c353",
      "49ddb3e70e665831",
      false,
    );

    expect(records[0]?.ClientRequestURI).toBe("/checkout");
  });

  it("surfaces Cloudflare API errors without returning the token", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          success: false,
          result: null,
          errors: [{ code: 10000, message: "Authentication error" }],
        },
        { status: 403 },
      ),
    );
    const client = new CloudflareClient("secret-token", fetcher);

    await expect(client.listAccounts()).rejects.toMatchObject({
      status: 403,
      message: "Authentication error",
    } satisfies Partial<CloudflareApiError>);
  });
});
