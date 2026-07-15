export type Diagnosis = {
  status: number;
  requests: number;
  likelyArea: "cloudflare" | "origin" | "application" | "unknown";
  finding: string;
  nextChecks: string[];
};

const STATUS_GUIDANCE: Record<
  number,
  Omit<Diagnosis, "status" | "requests">
> = {
  520: {
    likelyArea: "origin",
    finding:
      "The origin returned an empty, unknown, or unexpected response to Cloudflare.",
    nextChecks: [
      "Check origin application and web-server logs for the same UTC timestamps.",
      "Confirm response headers do not exceed the origin or Cloudflare limits.",
      "Test the origin directly with the expected Host header.",
    ],
  },
  521: {
    likelyArea: "origin",
    finding: "The origin refused Cloudflare's connection.",
    nextChecks: [
      "Confirm the origin service is listening on the configured port.",
      "Allow Cloudflare IP ranges through the origin firewall and security tools.",
      "Check connection limits and origin service health.",
    ],
  },
  522: {
    likelyArea: "origin",
    finding:
      "Cloudflare timed out while establishing or completing a TCP connection to the origin.",
    nextChecks: [
      "Check origin load, firewall drops, and connection limits.",
      "Run MTR from the origin network and compare it with the affected UTC window.",
      "Confirm Cloudflare IP ranges are allowed at every network layer.",
    ],
  },
  523: {
    likelyArea: "origin",
    finding: "Cloudflare could not route to the configured origin.",
    nextChecks: [
      "Verify Cloudflare DNS records contain the correct origin IP address.",
      "Check that the origin IP is publicly routable.",
      "Ask the hosting or network provider about routing failures.",
    ],
  },
  524: {
    likelyArea: "application",
    finding:
      "Cloudflare connected to the origin, but the origin did not return an HTTP response before the timeout.",
    nextChecks: [
      "Find slow requests in application and database logs.",
      "Measure direct-origin response time using the affected request path.",
      "Move long-running work to an asynchronous job where possible.",
    ],
  },
  525: {
    likelyArea: "origin",
    finding: "The TLS handshake between Cloudflare and the origin failed.",
    nextChecks: [
      "Validate the origin certificate, supported ciphers, and SNI configuration.",
      "Check the SSL/TLS mode configured for the zone.",
      "Test the origin TLS handshake with openssl using the affected hostname.",
    ],
  },
  526: {
    likelyArea: "origin",
    finding:
      "Cloudflare could not validate the origin certificate while using Full (strict) mode.",
    nextChecks: [
      "Confirm the origin certificate is unexpired and covers the hostname.",
      "Provide the complete certificate chain at the origin.",
      "Use a publicly trusted or Cloudflare Origin CA certificate.",
    ],
  },
};

export function summarizeHttpErrors(
  records: Record<string, unknown>[],
): Diagnosis[] {
  const counts = new Map<number, number>();
  for (const record of records) {
    const status = Number(record.EdgeResponseStatus);
    if (Number.isInteger(status) && status >= 400 && status <= 599) {
      counts.set(status, (counts.get(status) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([status, requests]) => {
      const known = STATUS_GUIDANCE[status];
      if (known) return { status, requests, ...known };
      if (status >= 500) {
        return {
          status,
          requests,
          likelyArea: "unknown",
          finding:
            "This server error needs request-level correlation to distinguish Cloudflare, Worker, and origin behavior.",
          nextChecks: [
            "Compare EdgeResponseStatus with OriginResponseStatus.",
            "Correlate the Ray ID and UTC timestamp with origin and Worker logs.",
            "Check recent configuration and deployment changes.",
          ],
        };
      }
      return {
        status,
        requests,
        likelyArea: status === 403 || status === 429 ? "cloudflare" : "unknown",
        finding:
          status === 403 || status === 429
            ? "A security, access, or rate-limiting control may have affected the request."
            : "The request was rejected or not found; inspect the request path and matching rules.",
        nextChecks: [
          "Inspect Security Events and matching rules for the same Ray ID and UTC timestamp.",
          "Confirm the expected request path, method, and authentication.",
          "Review recent ruleset and application changes.",
        ],
      };
    });
}

export function validateId(value: string, label: string): string {
  if (!/^[a-f0-9]{32}$/i.test(value)) {
    throw new Error(`${label} must be a 32-character hexadecimal ID`);
  }
  return value;
}

export function normalizeRayId(value: string): string {
  const rayId = value.trim().split("-")[0] ?? "";
  if (!/^[a-f0-9]{16,32}$/i.test(rayId)) {
    throw new Error(
      "Ray ID must contain 16–32 hexadecimal characters, optionally followed by a colo suffix",
    );
  }
  return rayId;
}

export function validateLogWindow(start: string, end: string): void {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    throw new Error("start and end must be valid ISO 8601 UTC timestamps");
  }
  if (!start.endsWith("Z") || !end.endsWith("Z")) {
    throw new Error("start and end must use UTC with a trailing Z");
  }
  if (endMs <= startMs) throw new Error("end must be later than start");
  if (endMs - startMs > 60 * 60 * 1_000) {
    throw new Error("Logpull time ranges cannot exceed one hour");
  }
  if (startMs < Date.now() - 7 * 24 * 60 * 60 * 1_000) {
    throw new Error("Logpull only supports data from the last seven days");
  }
}
