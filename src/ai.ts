import { analyzeIssue, redactSecrets, type IssueAnalysis } from "./support";

const VISION_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";
const MAX_IMAGE_DATA_URL_LENGTH = 5_700_000;

export async function analyzeIssueWithOptionalImage(
  ai: Ai,
  message: string,
  imageDataUrl?: string,
): Promise<
  IssueAnalysis & {
    aiUsed: boolean;
    screenshotSummary?: string;
    redactions: number;
  }
> {
  const redactedInput = redactSecrets(message);
  if (!imageDataUrl) {
    return {
      ...analyzeIssue(redactedInput.text),
      aiUsed: false,
      redactions: redactedInput.redactions,
    };
  }

  validateImage(imageDataUrl);
  const response = await ai.run(VISION_MODEL, {
    messages: [
      {
        role: "system",
        content:
          "You extract troubleshooting evidence from screenshots. Report only visible technical facts. Never invent a root cause. Never repeat passwords, cookies, tokens, authorization headers, private keys, personal data, or payment data. If such data is visible, write [REDACTED].",
      },
      {
        role: "user",
        content: `Describe the visible error and extract any Cloudflare error code, Ray ID, hostname, HTTP status, and timestamp. Clearly say when a value is uncertain. Customer context: ${redactedInput.text || "No text provided."}`,
      },
    ],
    image: imageDataUrl,
    max_tokens: 700,
  });

  const summaryRaw = getResponseText(response);
  const summary = redactSecrets(summaryRaw).text.slice(0, 8_000);
  const analysis = analyzeIssue(`${redactedInput.text}\n${summary}`);
  return {
    ...analysis,
    aiUsed: true,
    screenshotSummary: summary,
    redactions:
      redactedInput.redactions + redactSecrets(summaryRaw).redactions,
    needsConfirmation: true,
  };
}

function validateImage(dataUrl: string): void {
  if (dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
    throw new Error("Screenshot must be 4 MB or smaller");
  }
  if (!/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=\s]+$/.test(dataUrl)) {
    throw new Error("Screenshot must be a PNG, JPEG, GIF, or WebP image");
  }
}

function getResponseText(value: unknown): string {
  if (
    typeof value === "object" &&
    value !== null &&
    "response" in value &&
    typeof value.response === "string"
  ) {
    return value.response;
  }
  if (typeof value === "string") return value;
  throw new Error("The screenshot model returned an unsupported response");
}
