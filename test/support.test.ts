import { describe, expect, it } from "vitest";

import {
  analyzeIssue,
  generateCaseDraft,
  getRequiredEvidence,
  redactSecrets,
  validateSupportCase,
} from "../src/support";

describe("support issue analysis", () => {
  it("extracts known Cloudflare signals and gives rules-first guidance", () => {
    const analysis = analyzeIssue(
      "Error 522 for https://api.example.com at 2026-07-15T03:32:00Z Ray ID 49ddb3e70e665831-DFW",
    );

    expect(analysis).toMatchObject({
      likelyIssue: "Origin connection timed out (522)",
      likelyArea: "origin",
      confidence: "high",
      signals: {
        errorCodes: ["522"],
        rayIds: ["49ddb3e70e665831"],
        hostnames: ["api.example.com"],
        timestampsUtc: ["2026-07-15T03:32:00Z"],
      },
    });
  });

  it("provides issue-specific evidence", () => {
    expect(getRequiredEvidence("ssl")).toContain("Certificate chain");
    expect(getRequiredEvidence("workers")).toContain("Workers logs and exception");
  });
});

describe("support case validation and drafting", () => {
  const completeCase = {
    priority: "P2" as const,
    service: "CDN",
    zoneName: "example.com",
    hostnames: "api.example.com",
    startedUtc: "2026-07-15T03:32:00Z",
    frequency: "Every request",
    impact: "Checkout is unavailable for all users",
    expected: "Checkout succeeds",
    actual: "Requests return 522",
    reproduction: "Open the checkout URL",
    exactErrors: "Error 522",
  };

  it("requires core troubleshooting evidence", () => {
    expect(validateSupportCase({})).toMatchObject({
      ready: false,
      missing: expect.arrayContaining([
        "Priority",
        "Start timestamp in UTC",
        "Steps to reproduce",
      ]),
    });
    expect(validateSupportCase(completeCase).ready).toBe(true);
  });

  it("warns about unsupported attachment files", () => {
    expect(
      validateSupportCase({
        ...completeCase,
        attachments: "request.har evidence.zip",
      }).warnings,
    ).toEqual([expect.stringContaining("evidence.zip")]);
  });

  it("redacts secrets from generated drafts", () => {
    const draft = generateCaseDraft({
      ...completeCase,
      originFindings: "Authorization: Bearer very-secret-token-value",
    });
    expect(draft.body).toContain("[REDACTED]");
    expect(draft.body).not.toContain("very-secret-token-value");
  });
});

describe("secret redaction", () => {
  it("redacts token-like labels", () => {
    const result = redactSecrets("api_key=abc123456789 password: hunter2");
    expect(result.redactions).toBe(2);
    expect(result.text).toBe("[REDACTED] [REDACTED]");
  });
});
