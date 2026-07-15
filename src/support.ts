export type IssueType =
  | "outage"
  | "performance"
  | "dns"
  | "ssl"
  | "security"
  | "workers"
  | "zero-trust"
  | "other";

export type IssueAnalysis = {
  likelyIssue: string;
  likelyArea: "cloudflare" | "origin" | "application" | "network" | "unknown";
  confidence: "high" | "medium" | "low";
  explanation: string;
  signals: {
    errorCodes: string[];
    rayIds: string[];
    hostnames: string[];
    timestampsUtc: string[];
  };
  nextChecks: string[];
  requiredEvidence: string[];
  needsConfirmation: boolean;
};

export type SupportCase = {
  priority?: "P1" | "P2" | "P3" | "P4";
  service?: string;
  issueType?: IssueType;
  zoneName?: string;
  zoneId?: string;
  hostnames?: string;
  startedUtc?: string;
  frequency?: string;
  impact?: string;
  affectedUsers?: string;
  expected?: string;
  actual?: string;
  reproduction?: string;
  exampleUrls?: string;
  exactErrors?: string;
  rayIds?: string;
  recentChanges?: string;
  originFindings?: string;
  attachments?: string;
  participants?: string;
};

type ErrorRule = {
  title: string;
  area: IssueAnalysis["likelyArea"];
  explanation: string;
  checks: string[];
  evidence: string[];
};

const ERROR_RULES: Record<string, ErrorRule> = {
  "520": {
    title: "Unknown response from origin (520)",
    area: "origin",
    explanation:
      "Cloudflare received an empty, unknown, or unexpected response from the origin.",
    checks: [
      "Check origin application and web-server logs at the same UTC time.",
      "Test the origin directly with the affected Host header.",
      "Check for oversized or malformed response headers.",
    ],
    evidence: ["Origin logs", "Direct-origin curl output", "Response headers"],
  },
  "521": {
    title: "Origin refused connection (521)",
    area: "origin",
    explanation: "The origin refused Cloudflare's connection.",
    checks: [
      "Confirm the origin service is listening on the expected port.",
      "Allow Cloudflare IP ranges through origin firewalls.",
      "Check origin connection limits and service health.",
    ],
    evidence: ["Origin firewall logs", "Listening ports", "Origin health"],
  },
  "522": {
    title: "Origin connection timed out (522)",
    area: "origin",
    explanation:
      "Cloudflare did not complete the TCP connection to the origin in time.",
    checks: [
      "Check origin load, firewall drops, and connection limits.",
      "Confirm all Cloudflare IP ranges are allowed.",
      "Run MTR between the origin network and Cloudflare during the issue.",
    ],
    evidence: ["Origin logs", "Firewall logs", "MTR output"],
  },
  "523": {
    title: "Origin is unreachable (523)",
    area: "network",
    explanation:
      "Cloudflare could not route to the IP configured for the origin.",
    checks: [
      "Confirm DNS records contain the current origin IP.",
      "Verify that the origin IP is publicly routable.",
      "Check routing with the hosting or network provider.",
    ],
    evidence: ["DNS records", "Traceroute or MTR", "Origin IP confirmation"],
  },
  "524": {
    title: "Origin response timed out (524)",
    area: "application",
    explanation:
      "Cloudflare connected to the origin, but the application did not respond before the timeout.",
    checks: [
      "Find slow requests in application and database logs.",
      "Measure direct-origin response time for the affected path.",
      "Move long-running work to an asynchronous process where possible.",
    ],
    evidence: ["Application logs", "Database timing", "Direct-origin curl timing"],
  },
  "525": {
    title: "Origin TLS handshake failed (525)",
    area: "origin",
    explanation:
      "The TLS handshake between Cloudflare and the origin did not complete.",
    checks: [
      "Validate origin ciphers, SNI, and certificate configuration.",
      "Check the zone SSL/TLS mode.",
      "Test the origin with openssl using the affected hostname.",
    ],
    evidence: ["openssl output", "Origin TLS configuration", "SSL/TLS mode"],
  },
  "526": {
    title: "Invalid origin certificate (526)",
    area: "origin",
    explanation:
      "Cloudflare could not validate the origin certificate in Full (strict) mode.",
    checks: [
      "Confirm the certificate is valid, unexpired, and covers the hostname.",
      "Serve the complete certificate chain.",
      "Use a publicly trusted or Cloudflare Origin CA certificate.",
    ],
    evidence: ["Certificate chain", "openssl output", "SSL/TLS mode"],
  },
  "1000": {
    title: "DNS points to a prohibited IP (1000)",
    area: "cloudflare",
    explanation:
      "A DNS record points to an IP address Cloudflare cannot proxy.",
    checks: [
      "Review A, AAAA, and CNAME records for the affected hostname.",
      "Remove Cloudflare IP addresses or other prohibited targets from origin records.",
    ],
    evidence: ["Affected DNS records", "Expected origin address"],
  },
  "1016": {
    title: "Origin DNS error (1016)",
    area: "origin",
    explanation:
      "Cloudflare could not resolve the origin hostname or CNAME target.",
    checks: [
      "Resolve the origin hostname from multiple public resolvers.",
      "Check CNAME targets and delegated authoritative nameservers.",
      "Confirm the origin record has not expired or been removed.",
    ],
    evidence: ["dig output", "Affected DNS records", "Authoritative DNS response"],
  },
  "1020": {
    title: "Request blocked by a Cloudflare rule (1020)",
    area: "cloudflare",
    explanation:
      "A Cloudflare security rule denied the request. Use the Ray ID to find the matching event.",
    checks: [
      "Search Security Events using the Ray ID and UTC timestamp.",
      "Review the matched rule expression and action.",
      "Confirm whether the request should be allowed before changing a rule.",
    ],
    evidence: ["Ray ID", "Security Event", "Matched rule ID and expression"],
  },
  "1101": {
    title: "Worker threw an exception (1101)",
    area: "application",
    explanation: "A Cloudflare Worker terminated because of an exception.",
    checks: [
      "Inspect Workers logs at the same UTC timestamp.",
      "Reproduce against the deployed Worker version.",
      "Review recent deployments and exception stack traces.",
    ],
    evidence: ["Worker exception", "Worker version", "Deployment timestamp"],
  },
  "1102": {
    title: "Worker exceeded a resource limit (1102)",
    area: "application",
    explanation:
      "A Cloudflare Worker exceeded a CPU time or another runtime limit.",
    checks: [
      "Inspect Workers invocation logs and CPU time.",
      "Check for loops, expensive parsing, or excessive subrequests.",
      "Compare the issue with the latest Worker deployment.",
    ],
    evidence: ["Worker logs", "CPU timing", "Worker version"],
  },
};

const SECRET_PATTERNS = [
  /\b(?:authorization|api[-_ ]?key|token|password|secret)\s*[:=]\s*\S+/gi,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
];
const ACCEPTED_ATTACHMENT_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "ico",
  "tiff",
  "mp4",
  "avi",
  "webm",
  "har",
  "txt",
  "csv",
  "eml",
  "css",
  "html",
  "json",
  "tf",
  "pcap",
  "pcapng",
  "cap",
]);

export function redactSecrets(value: string): {
  text: string;
  redactions: number;
} {
  let text = value;
  let redactions = 0;
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, () => {
      redactions += 1;
      return "[REDACTED]";
    });
  }
  return { text, redactions };
}

export function analyzeIssue(textInput: string): IssueAnalysis {
  const { text } = redactSecrets(textInput.slice(0, 20_000));
  const errorCodes = unique(
    [
      ...text.matchAll(
        /(?:error(?:\s+code)?[\s:#-]*|cloudflare\s+)(\d{3,4})\b/gi,
      ),
      ...text.matchAll(/\b(52[0-6]|10(?:00|16|20)|110[12])\b/g),
    ].map((match) => match[1] ?? ""),
  );
  const rayIds = unique(
    [...text.matchAll(/\b([a-f0-9]{16,32})(?:-[A-Z]{3})?\b/gi)].map(
      (match) => match[1] ?? "",
    ),
  );
  const hostnames = unique(
    [...text.matchAll(/\b(?:https?:\/\/)?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z]{2,})+)\b/gi)]
      .map((match) => match[1] ?? "")
      .filter((value) => !value.endsWith("cloudflare.com")),
  );
  const timestampsUtc = unique(
    [...text.matchAll(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?Z\b/g)].map(
      (match) => match[0],
    ),
  );
  const rule = errorCodes.map((code) => ERROR_RULES[code]).find(Boolean);

  if (rule) {
    return {
      likelyIssue: rule.title,
      likelyArea: rule.area,
      confidence: "high",
      explanation: rule.explanation,
      signals: { errorCodes, rayIds, hostnames, timestampsUtc },
      nextChecks: rule.checks,
      requiredEvidence: commonEvidence(rule.evidence),
      needsConfirmation: false,
    };
  }

  const lower = text.toLowerCase();
  const inferred =
    lower.includes("certificate") || lower.includes("ssl") || lower.includes("tls")
      ? {
          title: "SSL/TLS issue",
          area: "origin" as const,
          explanation:
            "The description suggests a certificate or TLS negotiation problem.",
          checks: [
            "Capture the exact browser or TLS error.",
            "Test both edge and origin certificates with openssl.",
            "Confirm the Cloudflare SSL/TLS mode.",
          ],
        }
      : lower.includes("dns") ||
          lower.includes("nxdomain") ||
          lower.includes("resolve")
        ? {
            title: "DNS resolution issue",
            area: "network" as const,
            explanation:
              "The description suggests that a hostname or origin cannot be resolved.",
            checks: [
              "Run dig against the authoritative nameservers.",
              "Compare public resolver answers.",
              "Review recent DNS changes.",
            ],
          }
        : lower.includes("slow") ||
            lower.includes("latency") ||
            lower.includes("timeout")
          ? {
              title: "Performance or timeout issue",
              area: "unknown" as const,
              explanation:
                "The description suggests latency or timeout symptoms, but more evidence is needed to locate the delay.",
              checks: [
                "Record response timing with curl.",
                "Compare proxied and direct-origin performance.",
                "Collect MTR and origin application timing.",
              ],
            }
          : {
              title: "Issue needs more evidence",
              area: "unknown" as const,
              explanation:
                "No known Cloudflare error code or specific fault signal was found.",
              checks: [
                "Provide the exact error message and affected URL.",
                "Capture a Ray ID and UTC timestamp from one failed request.",
                "Describe expected versus actual behavior.",
              ],
            };

  return {
    likelyIssue: inferred.title,
    likelyArea: inferred.area,
    confidence: text.length > 40 ? "medium" : "low",
    explanation: inferred.explanation,
    signals: { errorCodes, rayIds, hostnames, timestampsUtc },
    nextChecks: inferred.checks,
    requiredEvidence: commonEvidence([]),
    needsConfirmation: true,
  };
}

export function getRequiredEvidence(issueType: IssueType): string[] {
  const common = [
    "Affected zone, hostname, and Zone ID",
    "Incident start time in UTC and frequency",
    "Business impact and priority",
    "Steps to reproduce with expected and actual results",
    "Exact errors, example URLs, Ray IDs, and screenshots",
  ];
  const specific: Record<IssueType, string[]> = {
    outage: ["Origin web-server logs", "curl and MTR output", "Origin health"],
    performance: [
      "HAR file",
      "curl timing output",
      "Origin application and database timing",
    ],
    dns: ["dig or nslookup output", "Authoritative nameservers", "DNS record values"],
    ssl: ["openssl output", "Certificate chain", "Cloudflare SSL/TLS mode"],
    security: ["Security Event and rule ID", "Ray ID", "Expected rule behavior"],
    workers: [
      "Worker name and version",
      "Workers logs and exception",
      "Deployment timestamp",
    ],
    "zero-trust": [
      "Zero Trust product and policy",
      "Device and WARP diagnostics",
      "User and application impact",
    ],
    other: ["Relevant origin logs", "Network diagnostics", "Recent changes"],
  };
  return [...common, ...specific[issueType]];
}

export function validateSupportCase(data: SupportCase): {
  ready: boolean;
  missing: string[];
  warnings: string[];
} {
  const missing: string[] = [];
  if (!data.priority) missing.push("Priority");
  if (!data.zoneName && !data.hostnames) missing.push("Affected zone or hostname");
  if (!data.startedUtc) missing.push("Start timestamp in UTC");
  if (!data.impact) missing.push("Business impact");
  if (!data.frequency) missing.push("Problem frequency");
  if (!data.expected) missing.push("Expected result");
  if (!data.actual) missing.push("Actual result");
  if (!data.reproduction) missing.push("Steps to reproduce");
  if (!data.exactErrors && !data.rayIds && !data.attachments) {
    missing.push("At least one error, Ray ID, or evidence attachment");
  }

  const warnings: string[] = [];
  const combined = Object.values(data).filter(Boolean).join("\n");
  if (redactSecrets(combined).redactions > 0) {
    warnings.push(
      "Possible password, API token, authorization value, or private key detected. Remove secrets before submitting.",
    );
  }
  if (data.priority === "P1" && !/down|outage|attack|unavailable|critical/i.test(data.impact ?? "")) {
    warnings.push(
      "P1 is for critical business impact such as a severe outage or active attack. Confirm this priority.",
    );
  }
  const unsupported = unique(
    [...(data.attachments ?? "").matchAll(/(?:^|[\s,])([^\s,]+\.(\w+))/g)]
      .filter((match) => !ACCEPTED_ATTACHMENT_EXTENSIONS.has((match[2] ?? "").toLowerCase()))
      .map((match) => match[1] ?? ""),
  );
  if (unsupported.length) {
    warnings.push(
      `Unsupported attachment type: ${unsupported.join(", ")}. Use a Cloudflare-supported image, video, text, HAR, or packet-capture format.`,
    );
  }
  return { ready: missing.length === 0, missing, warnings };
}

export function generateCaseDraft(data: SupportCase): {
  title: string;
  body: string;
  validation: ReturnType<typeof validateSupportCase>;
} {
  const validation = validateSupportCase(data);
  const safe = Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      typeof value === "string" ? redactSecrets(value).text : value,
    ]),
  ) as SupportCase;
  const title = `${safe.priority ?? "[Priority]"} ${safe.service ?? "Cloudflare"} – ${firstLine(safe.actual) || "Issue requiring investigation"}`;
  const body = `Title: ${title}

Account / zone
- Zone name: ${safe.zoneName ?? ""}
- Zone ID: ${safe.zoneId ?? ""}
- Affected hostnames: ${safe.hostnames ?? ""}

Impact
- Priority: ${safe.priority ?? ""}
- Production impact: ${safe.impact ?? ""}
- Affected users/regions: ${safe.affectedUsers ?? ""}
- Started (UTC): ${safe.startedUtc ?? ""}
- Frequency: ${safe.frequency ?? ""}

Issue
- Expected behavior: ${safe.expected ?? ""}
- Actual behavior: ${safe.actual ?? ""}
- Exact error(s): ${safe.exactErrors ?? ""}
- Steps to reproduce: ${safe.reproduction ?? ""}
- Example URL(s): ${safe.exampleUrls ?? ""}

Investigation
- Cloudflare Ray ID(s): ${safe.rayIds ?? ""}
- Recent changes: ${safe.recentChanges ?? ""}
- Origin/log findings: ${safe.originFindings ?? ""}

Attached evidence
- ${safe.attachments ?? "None listed"}

Case participants
- CC: ${safe.participants ?? ""}`;
  return { title, body, validation };
}

function commonEvidence(specific: string[]): string[] {
  return unique([
    "Affected hostname and Zone ID",
    "One failed request timestamp in UTC",
    "Ray ID and exact error",
    "Expected versus actual result",
    ...specific,
  ]);
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function firstLine(value?: string): string {
  return value?.split(/\r?\n/)[0]?.slice(0, 90) ?? "";
}
