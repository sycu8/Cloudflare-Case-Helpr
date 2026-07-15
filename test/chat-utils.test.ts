import { describe, expect, it } from "vitest";

// @ts-expect-error Browser utility is intentionally shipped as plain JavaScript.
import { parseHumanUtc } from "../public/chat-utils.js";

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
