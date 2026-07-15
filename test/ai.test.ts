import { describe, expect, it, vi } from "vitest";

import { analyzeIssueWithOptionalImage } from "../src/ai";

describe("screenshot analysis", () => {
  it("sends the image as multimodal content and requires confirmation", async () => {
    const run = vi.fn().mockResolvedValue({
      response:
        "Visible Cloudflare Error 526 for api.example.com. Ray ID 49ddb3e70e665831.",
    });

    const result = await analyzeIssueWithOptionalImage(
      { run },
      "Customers see an error",
      "data:image/png;base64,aGVsbG8=",
    );

    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0]?.[1]).toMatchObject({
      messages: [
        expect.any(Object),
        {
          content: expect.arrayContaining([
            {
              type: "image_url",
              image_url: {
                url: "data:image/png;base64,aGVsbG8=",
              },
            },
          ]),
        },
      ],
    });
    expect(result).toMatchObject({
      likelyIssue: "Invalid origin certificate (526)",
      aiUsed: true,
      needsConfirmation: true,
    });
  });

  it("rejects unsupported screenshot formats before inference", async () => {
    const run = vi.fn();
    await expect(
      analyzeIssueWithOptionalImage(
        { run },
        "",
        "data:image/svg+xml;base64,PHN2Zz4=",
      ),
    ).rejects.toThrow(/PNG, JPEG, GIF, or WebP/);
    expect(run).not.toHaveBeenCalled();
  });
});
