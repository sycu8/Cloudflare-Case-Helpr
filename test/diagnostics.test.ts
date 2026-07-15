import { describe, expect, it, vi } from "vitest";

import {
  normalizeRayId,
  summarizeHttpErrors,
  validateId,
  validateLogWindow,
} from "../src/diagnostics";

describe("normalizeRayId", () => {
  it("removes an optional data center suffix", () => {
    expect(normalizeRayId("49ddb3e70e665831-DFW")).toBe("49ddb3e70e665831");
  });

  it("rejects malformed values", () => {
    expect(() => normalizeRayId("not-a-ray")).toThrow(/16–32/);
  });
});

describe("validateId", () => {
  it("accepts Cloudflare account and zone identifiers", () => {
    const id = "023e105f4ecef8ad9ca31a8372d0c353";
    expect(validateId(id, "zone_id")).toBe(id);
  });

  it("rejects identifiers with an invalid length", () => {
    expect(() => validateId("abcd", "zone_id")).toThrow(/32-character/);
  });
});

describe("validateLogWindow", () => {
  it("accepts a recent UTC window under one hour", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T03:30:00Z"));
    expect(() =>
      validateLogWindow(
        "2026-07-15T02:00:00Z",
        "2026-07-15T02:30:00Z",
      ),
    ).not.toThrow();
    vi.useRealTimers();
  });

  it("rejects non-UTC and oversized windows", () => {
    expect(() =>
      validateLogWindow(
        "2026-07-15T00:00:00+01:00",
        "2026-07-15T00:10:00+01:00",
      ),
    ).toThrow(/UTC/);
    expect(() =>
      validateLogWindow(
        "2026-07-15T00:00:00Z",
        "2026-07-15T02:00:00Z",
      ),
    ).toThrow(/one hour/);
  });
});

describe("summarizeHttpErrors", () => {
  it("groups errors and provides rules-first guidance", () => {
    const diagnoses = summarizeHttpErrors([
      { EdgeResponseStatus: 522 },
      { EdgeResponseStatus: 522 },
      { EdgeResponseStatus: 403 },
      { EdgeResponseStatus: 200 },
    ]);

    expect(diagnoses).toHaveLength(2);
    expect(diagnoses[0]).toMatchObject({
      status: 522,
      requests: 2,
      likelyArea: "origin",
    });
    expect(diagnoses[1]).toMatchObject({
      status: 403,
      requests: 1,
      likelyArea: "cloudflare",
    });
  });
});
