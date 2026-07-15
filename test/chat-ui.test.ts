import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

describe("local chatbot UI", () => {
  it("uses a conversational interface instead of the old case form", () => {
    expect(html).toContain('id="messages"');
    expect(html).toContain('id="composer"');
    expect(html).not.toContain('id="case-form"');
  });

  it("persists chat locally and generates the case in the browser", () => {
    expect(script).toContain('const STORAGE_KEY = "cf-support-chat-v2"');
    expect(script).toContain("function generateCaseDraft(data)");
    expect(script).toContain("localStorage.setItem(STORAGE_KEY");
  });

  it("keeps generated Support case drafts in English only", () => {
    expect(html).not.toContain("Translate draft");
    expect(html).not.toContain("data-draft-language");
    expect(script).not.toContain('api("/api/translate"');
  });

  it("provides collection guidance for minimum and P1 questions", () => {
    expect(script).toContain("How often does the problem happen?");
    expect(script).toContain("What did you find at the origin?");
    expect(script).toContain("P1 requires ongoing customer availability");
  });

  it("asks for impacted services when Other is selected", () => {
    expect(script).toContain('data.issueType === "other"');
    expect(script).toContain(
      "Which Cloudflare service or services are impacted?",
    );
    expect(script).toContain('["service", "Impacted service(s)"]');
  });

  it("accepts screenshots pasted from the clipboard", () => {
    expect(script).toContain('elements.composer.addEventListener("paste"');
    expect(script).toContain("event.clipboardData?.items");
    expect(script).toContain('item.type.startsWith("image/")');
    expect(html).toContain("paste it here with Ctrl+V or ⌘V");
  });
});
