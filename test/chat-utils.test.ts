import { describe, expect, it } from "vitest";

// @ts-expect-error Browser utility is intentionally shipped as plain JavaScript.
import { displayedDraft, draftStatusMessage, draftTranslationRequest, isDuplicateComposerSubmission, normalizeDraftLanguage, parseHumanUtc } from "../public/chat-utils.js";

const referenceDate = new Date("2026-07-15T06:45:00Z");

describe("human UTC date parsing", () => {
  it.each([
    ["2026-07-15T03:32:00Z", "2026-07-15T03:32:00.000Z"],
    ["today at 2:43 PM UTC", "2026-07-15T14:43:00.000Z"],
    ["yesterday 09:15 UTC", "2026-07-14T09:15:00.000Z"],
    ["15/07/2026 14:43", "2026-07-15T14:43:00.000Z"],
    ["July 15, 2026 at 2:43 PM UTC", "2026-07-15T14:43:00.000Z"],
    ["July 15, 2026 14:43 UTC+7", "2026-07-15T07:43:00.000Z"],
  ])("normalizes %s", (input, expected) => {
    expect(parseHumanUtc(input, referenceDate)).toBe(expected);
  });

  it("rejects text without a recognizable date", () => {
    expect(parseHumanUtc("sometime before lunch", referenceDate)).toBe("");
  });
});

describe("composer duplicate protection", () => {
  it("suppresses an immediate suffix left by text composition", () => {
    expect(
      isDuplicateComposerSubmission("today at 3pm", "pm", 120),
    ).toBe(true);
  });

  it("shows English, Vietnamese, and Khmer drafts from the menu language", () => {
    const english = "Title: P3 CDN – Error 522\n- Ray ID: 49ddb3e70e665831";

    expect(normalizeDraftLanguage("en")).toBe("en");
    expect(normalizeDraftLanguage("vi")).toBe("vi");
    expect(normalizeDraftLanguage("km")).toBe("km");
    expect(normalizeDraftLanguage("fr")).toBe("en");

    expect(draftTranslationRequest(english, "en")).toBeNull();
    expect(draftTranslationRequest("  ", "vi")).toBeNull();
    expect(draftTranslationRequest(english, "vi")).toEqual({
      path: "/api/translate",
      body: { text: english, targetLanguage: "vi" },
    });
    expect(draftTranslationRequest(english, "km").body.targetLanguage).toBe("km");

    expect(displayedDraft(english, "en", "ignored")).toEqual({
      text: english,
      language: "en",
      fellBack: false,
    });
    expect(displayedDraft(english, "vi", "Tiêu đề: P3 CDN")).toEqual({
      text: "Tiêu đề: P3 CDN",
      language: "vi",
      fellBack: false,
    });
    expect(displayedDraft(english, "km", "   ")).toEqual({
      text: english,
      language: "en",
      fellBack: true,
    });
    expect(displayedDraft(english, "vi", undefined)).toMatchObject({
      text: english,
      fellBack: true,
    });
    expect(draftStatusMessage("km", false)).toBe("Draft shown in ខ្មែរ.");
    expect(draftStatusMessage("vi", true)).toBe(
      "Translation failed. Showing the English draft.",
    );
  });

  it("allows unrelated answers and delayed text", () => {
    expect(
      isDuplicateComposerSubmission("today at 3pm", "Every request", 120),
    ).toBe(false);
    expect(
      isDuplicateComposerSubmission("today at 3pm", "pm", 2_000),
    ).toBe(false);
  });
});
