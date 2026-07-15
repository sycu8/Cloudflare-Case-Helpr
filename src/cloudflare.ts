const API_BASE = "https://api.cloudflare.com/client/v4";
const GRAPHQL_URL = `${API_BASE}/graphql`;
const MAX_BODY_BYTES = 1_000_000;

export type CloudflareError = {
  code?: number;
  message?: string;
};

type ApiEnvelope<T> = {
  success: boolean;
  result: T;
  errors?: CloudflareError[];
  messages?: CloudflareError[];
  result_info?: unknown;
};

export class CloudflareApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details: CloudflareError[] = [],
  ) {
    super(message);
    this.name = "CloudflareApiError";
  }
}

export class CloudflareClient {
  constructor(
    private readonly apiToken: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async verifyToken(): Promise<unknown> {
    return this.api<unknown>("/user/tokens/verify");
  }

  async listAccounts(): Promise<unknown> {
    return this.api<unknown>("/accounts?per_page=50");
  }

  async listZones(accountId?: string): Promise<unknown> {
    const query = new URLSearchParams({ per_page: "50" });
    if (accountId) query.set("account.id", accountId);
    return this.api<unknown>(`/zones?${query.toString()}`);
  }

  async lookupRayId(
    zoneId: string,
    rayId: string,
    includeQueryString: boolean,
  ): Promise<Record<string, unknown>[]> {
    const fields = troubleshootingFields();
    const query = new URLSearchParams({
      fields: fields.join(","),
      timestamps: "rfc3339",
    });
    const response = await this.request(
      `/zones/${zoneId}/logs/rayids/${rayId}?${query.toString()}`,
    );
    const records = await parseNdjson(response);
    return sanitizeRecords(records, includeQueryString);
  }

  async getHttpLogs(input: {
    zoneId: string;
    start: string;
    end: string;
    limit: number;
    statusCode?: number;
    hostname?: string;
    includeQueryString: boolean;
  }): Promise<Record<string, unknown>[]> {
    const query = new URLSearchParams({
      start: input.start,
      end: input.end,
      count: String(input.limit),
      fields: troubleshootingFields().join(","),
      timestamps: "rfc3339",
    });
    const response = await this.request(
      `/zones/${input.zoneId}/logs/received?${query.toString()}`,
    );
    const records = sanitizeRecords(
      await parseNdjson(response),
      input.includeQueryString,
    );

    return records.filter((record) => {
      if (
        input.statusCode !== undefined &&
        record.EdgeResponseStatus !== input.statusCode
      ) {
        return false;
      }
      if (
        input.hostname &&
        String(record.ClientRequestHost ?? "").toLowerCase() !==
          input.hostname.toLowerCase()
      ) {
        return false;
      }
      return true;
    });
  }

  async getErrorAnalytics(input: {
    zoneId: string;
    start: string;
    end: string;
    hostname?: string;
  }): Promise<unknown> {
    const query = `
      query ErrorSummary($zoneTag: string, $filter: ZoneHttpRequestsAdaptiveGroupsFilter_InputObject) {
        viewer {
          zones(filter: { zoneTag: $zoneTag }) {
            httpRequestsAdaptiveGroups(
              limit: 100
              orderBy: [count_DESC]
              filter: $filter
            ) {
              count
              avg { sampleInterval }
              dimensions {
                edgeResponseStatus
                clientRequestHTTPHost
                originResponseStatus
              }
            }
          }
        }
      }
    `;
    const filter: Record<string, unknown> = {
      datetime_geq: input.start,
      datetime_lt: input.end,
      requestSource: "eyeball",
      edgeResponseStatus_geq: 400,
    };
    if (input.hostname) filter.clientRequestHTTPHost = input.hostname;

    const response = await this.fetcher(GRAPHQL_URL, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        query,
        variables: { zoneTag: input.zoneId, filter },
      }),
    });
    const body = await readJsonBody<{
      data?: unknown;
      errors?: Array<{ message?: string }>;
    }>(response);
    if (!response.ok || body.errors?.length) {
      throw new CloudflareApiError(
        body.errors?.map((error) => error.message).join("; ") ||
          `Cloudflare GraphQL request failed (${response.status})`,
        response.status,
      );
    }
    return body.data;
  }

  async getAuditLogs(input: {
    accountId: string;
    start: string;
    end: string;
    zoneId?: string;
  }): Promise<unknown> {
    const query = new URLSearchParams({
      since: input.start,
      before: input.end,
      direction: "desc",
      limit: "100",
    });
    if (input.zoneId) query.set("zone_id", input.zoneId);
    return this.api<unknown>(
      `/accounts/${input.accountId}/logs/audit?${query.toString()}`,
    );
  }

  private async api<T>(path: string): Promise<T> {
    const response = await this.request(path);
    const body = await readJsonBody<ApiEnvelope<T>>(response);
    if (!response.ok || !body.success) {
      const details = body.errors ?? [];
      throw new CloudflareApiError(
        details.map((error) => error.message).filter(Boolean).join("; ") ||
          `Cloudflare API request failed (${response.status})`,
        response.status,
        details,
      );
    }
    return body.result;
  }

  private request(path: string): Promise<Response> {
    return this.fetcher(`${API_BASE}${path}`, {
      headers: this.headers(),
    });
  }

  private headers(additional?: Record<string, string>): Headers {
    const headers = new Headers(additional);
    headers.set("Authorization", `Bearer ${this.apiToken}`);
    headers.set(
      "User-Agent",
      "cloudflare-case-helper-mcp/0.1 (+https://github.com/sycu8/Cloudflare-Case-Helpr)",
    );
    return headers;
  }
}

function troubleshootingFields(): string[] {
  return [
    "RayID",
    "EdgeStartTimestamp",
    "EdgeEndTimestamp",
    "ClientRequestHost",
    "ClientRequestMethod",
    "ClientRequestURI",
    "EdgeResponseStatus",
    "OriginResponseStatus",
    "OriginResponseTime",
    "CacheCacheStatus",
    "ColoCode",
    "RequestSource",
  ];
}

async function readJsonBody<T>(response: Response): Promise<T> {
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    throw new CloudflareApiError("Cloudflare response exceeded 1 MB", 502);
  }
  const text = await response.text();
  if (text.length > MAX_BODY_BYTES) {
    throw new CloudflareApiError("Cloudflare response exceeded 1 MB", 502);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new CloudflareApiError(
      `Cloudflare returned a non-JSON response (${response.status})`,
      response.status,
    );
  }
}

async function parseNdjson(
  response: Response,
): Promise<Record<string, unknown>[]> {
  if (!response.ok) {
    const text = (await response.text()).slice(0, 2_000);
    let details: CloudflareError[] = [];
    try {
      const parsed = JSON.parse(text) as { errors?: CloudflareError[] };
      details = parsed.errors ?? [];
    } catch {
      // Logpull may return plain text errors.
    }
    throw new CloudflareApiError(
      details.map((error) => error.message).filter(Boolean).join("; ") ||
        text ||
        `Cloudflare Logpull request failed (${response.status})`,
      response.status,
      details,
    );
  }

  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    throw new CloudflareApiError(
      "Log response exceeded 1 MB; narrow the time range or lower the limit",
      413,
    );
  }
  const text = await response.text();
  if (text.length > MAX_BODY_BYTES) {
    throw new CloudflareApiError(
      "Log response exceeded 1 MB; narrow the time range or lower the limit",
      413,
    );
  }

  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function sanitizeRecords(
  records: Record<string, unknown>[],
  includeQueryString: boolean,
): Record<string, unknown>[] {
  if (includeQueryString) return records;
  return records.map((record) => {
    const sanitized = { ...record };
    if (typeof sanitized.ClientRequestURI === "string") {
      sanitized.ClientRequestURI = sanitized.ClientRequestURI.split("?")[0];
    }
    return sanitized;
  });
}
