import { analyzeIssue, redactSecrets, type IssueAnalysis } from "./support";

const VISION_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";
const MAX_IMAGE_DATA_URL_LENGTH = 5_700_000;
const LANGUAGE_NAMES = {
  en: "English",
  vi: "Vietnamese",
  km: "Khmer",
} as const;

export async function analyzeIssueWithOptionalImage(
  ai: Pick<Ai, "run">,
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
        content: [
          {
            type: "text",
            text: `Describe the visible error and extract any Cloudflare error code, Ray ID, hostname, HTTP status, and timestamp. Clearly say when a value is uncertain. Customer context: ${redactedInput.text || "No text provided."}`,
          },
          {
            type: "image_url",
            image_url: { url: imageDataUrl },
          },
        ],
      },
    ],
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

export async function translateUiContent(
  ai: Pick<Ai, "run">,
  strings: string[],
  targetLanguage: "vi" | "km",
): Promise<string[]> {
  if (strings.length === 0 || strings.length > 250) {
    throw new Error("UI translation requires between 1 and 250 strings");
  }
  const source = strings.map((value) => value.slice(0, 500));
  const response = await ai.run(VISION_MODEL, {
    messages: [
      {
        role: "system",
        content:
          "Translate user-interface text for a Cloudflare troubleshooting application. Preserve Cloudflare product names, P1/P2/P3/P4, HTTP codes, Ray ID, UTC, URLs, file extensions, and technical abbreviations. Return only a JSON object with one key named translations. Its value must be an array with exactly the same number and order of strings as the input. Do not add explanations.",
      },
      {
        role: "user",
        content: `Target language: ${LANGUAGE_NAMES[targetLanguage]}\nInput JSON: ${JSON.stringify(source)}`,
      },
    ],
    response_format: { type: "json_object" },
    max_tokens: 8_000,
    temperature: 0,
  });
  const parsed = parseTranslationJson(getResponseText(response));
  if (
    !Array.isArray(parsed.translations) ||
    parsed.translations.length !== source.length ||
    !parsed.translations.every((value) => typeof value === "string")
  ) {
    throw new Error("The UI translation response did not match the source content");
  }
  return parsed.translations;
}

function validateImage(dataUrl: string): void {
  if (dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
    throw new Error("Screenshot must be 4 MB or smaller");
  }
  if (!/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=\s]+$/.test(dataUrl)) {
    throw new Error("Screenshot must be a PNG, JPEG, GIF, or WebP image");
  }
}

function parseTranslationJson(value: string): { translations?: unknown } {
  const normalized = value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(normalized) as { translations?: unknown };
  } catch {
    throw new Error("The UI translation model returned invalid JSON");
  }
}

function getResponseText(value: unknown): string {
  if (
    typeof value === "object" &&
    value !== null &&
    "response" in value
  ) {
    if (typeof value.response === "string") return value.response;
    if (typeof value.response === "object" && value.response !== null) {
      return JSON.stringify(value.response);
    }
  }
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  throw new Error("Workers AI returned an unsupported response");
}
