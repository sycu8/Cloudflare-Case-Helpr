import { describe, expect, it, vi } from "vitest";

import {
  analyzeIssueWithOptionalImage,
  translateSupportContent,
  translateUiContent,
} from "../src/ai";

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

  it("translates support content while requesting technical-value preservation", async () => {
    const run = vi.fn().mockResolvedValue({
      response:
        "Lỗi thực tế: Cloudflare Error 522\nRay ID: 49ddb3e70e665831",
    });

    const result = await translateSupportContent(
      { run },
      "Actual result: Cloudflare Error 522\nRay ID: 49ddb3e70e665831",
      "vi",
    );

    expect(result.translation).toContain("Cloudflare Error 522");
    expect(result.translation).toContain("49ddb3e70e665831");
    expect(run.mock.calls[0]?.[1]).toMatchObject({
      messages: [
        expect.objectContaining({
          content: expect.stringContaining("Preserve headings"),
        }),
        expect.objectContaining({
          content: expect.stringContaining("Vietnamese"),
        }),
      ],
      temperature: 0,
    });
  });

  it("returns ordered UI translations for browser caching", async () => {
    const run = vi.fn().mockResolvedValue({
      response: JSON.stringify({
        translations: ["Phân tích sự cố", "Tạo bản nháp"],
      }),
    });

    const result = await translateUiContent(
      { run },
      ["Analyze issue", "Generate draft"],
      "vi",
    );

    expect(result).toEqual(["Phân tích sự cố", "Tạo bản nháp"]);
    expect(run.mock.calls[0]?.[1]).toMatchObject({
      response_format: { type: "json_object" },
      temperature: 0,
    });
  });

  it("rejects incomplete UI translation responses", async () => {
    const run = vi.fn().mockResolvedValue({
      response: JSON.stringify({ translations: ["តែមួយ"] }),
    });

    await expect(
      translateUiContent({ run }, ["One", "Two"], "km"),
    ).rejects.toThrow(/did not match/);
  });
});
