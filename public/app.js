import { parseHumanUtc } from "./chat-utils.js";

const STORAGE_KEY = "cf-support-chat-v2";
const UI_LANGUAGE_KEY = "cf-support-ui-language";
const UI_TRANSLATION_VERSION = "chat-v1";
const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024;

const elements = {
  messages: document.querySelector("#messages"),
  quickReplies: document.querySelector("#quick-replies"),
  composer: document.querySelector("#composer"),
  input: document.querySelector("#chat-input"),
  send: document.querySelector("#send-message"),
  status: document.querySelector("#composer-status"),
  screenshot: document.querySelector("#screenshot"),
  attachmentPreview: document.querySelector("#attachment-preview"),
  attachmentName: document.querySelector("#attachment-name"),
  removeAttachment: document.querySelector("#remove-attachment"),
  clear: document.querySelector("#clear-chat"),
  score: document.querySelector("#readiness-score"),
  progressRing: document.querySelector("#progress-ring"),
  progressBar: document.querySelector("#progress-bar"),
  readinessCopy: document.querySelector("#readiness-copy"),
  collectedList: document.querySelector("#collected-list"),
  answerCount: document.querySelector("#answer-count"),
  evidenceList: document.querySelector("#evidence-list"),
  draftPanel: document.querySelector("#draft-panel"),
  draftOutput: document.querySelector("#draft-output"),
  draftStatus: document.querySelector("#draft-status"),
  draftLanguageButtons: document.querySelectorAll("[data-draft-language]"),
  copyDraft: document.querySelector("#copy-draft"),
  languageMenu: document.querySelector("#language-menu"),
  languageMenuToggle: document.querySelector("#language-menu-toggle"),
  languageMenuPopover: document.querySelector("#language-menu-popover"),
  currentLanguage: document.querySelector("#current-language"),
  uiLanguageButtons: document.querySelectorAll("[data-ui-language]"),
};

const issueTypes = {
  outage: "Outage or availability",
  performance: "Performance",
  dns: "DNS",
  ssl: "SSL / TLS",
  security: "Security or WAF",
  workers: "Workers",
  "zero-trust": "Cloudflare One / Zero Trust",
  other: "Other",
};

const questions = {
  issueType: {
    prompt: "Which Cloudflare area is affected?",
    guidance:
      "Choose the closest product area. This changes the evidence checklist. If you are unsure, choose Other.",
    options: Object.entries(issueTypes).map(([value, label]) => ({ value, label })),
  },
  priority: {
    prompt: "How severe is the business impact?",
    guidance:
      "P1: severe outage or active attack. P2: significant but localized disruption. P3: moderate impact. P4: low impact or a general question.",
    options: [
      { value: "P1", label: "P1 · Critical" },
      { value: "P2", label: "P2 · High" },
      { value: "P3", label: "P3 · Normal" },
      { value: "P4", label: "P4 · Low" },
    ],
  },
  service: {
    prompt: "Which Cloudflare service is affected?",
    guidance:
      "Use the product name shown in the Dashboard, for example CDN, DNS, WAF, Workers, Access, Gateway, or Magic Transit.",
    placeholder: "Example: CDN and WAF",
  },
  hostnames: {
    prompt: "What zone or hostname is affected?",
    guidance:
      "Provide the public hostname users request, such as api.example.com. You can find the zone in the Cloudflare Dashboard account overview.",
    placeholder: "Example: api.example.com",
  },
  startedUtc: {
    prompt: "When did the issue start?",
    guidance:
      "Use the time shown on the error page, HAR, monitoring alert, or origin log. You can answer naturally, for example “today at 2:43 PM UTC” or “15 July 2026 14:43 UTC.” I will convert it to UTC.",
    placeholder: "Example: today at 2:43 PM UTC",
    normalize(value) {
      return parseHumanUtc(value);
    },
    validate(value, normalized) {
      return normalized
        ? ""
        : "I could not understand that date. Try “today at 2:43 PM UTC” or “15 July 2026 14:43 UTC.”";
    },
  },
  frequency: {
    prompt: "How often does the problem happen?",
    guidance:
      "State whether every request fails, it is intermittent, it affects a percentage of traffic, or it happened once.",
    placeholder: "Example: Every request for the last 20 minutes",
  },
  impact: {
    prompt: "What is the production and business impact?",
    guidance:
      "Describe what users cannot do and the business effect. Include availability, revenue, security, or operational impact rather than only saying “it is broken.”",
    placeholder: "Example: Checkout is unavailable for all customers",
  },
  affectedUsers: {
    prompt: "Which users, regions, or networks are affected?",
    guidance:
      "For P1, state whether all users are affected. Otherwise list affected countries, ISPs, offices, applications, or approximate user percentage.",
    placeholder: "Example: All users in APAC across multiple ISPs",
  },
  expected: {
    prompt: "What did you expect to happen?",
    guidance:
      "Describe the successful behavior in one or two sentences. This gives Support a clear comparison point.",
    placeholder: "Example: The API should return HTTP 200 within two seconds",
  },
  actual: {
    prompt: "What actually happens?",
    guidance:
      "Include the visible symptom and status code. Avoid conclusions unless evidence proves the cause.",
    placeholder: "Example: Requests return Cloudflare Error 522",
  },
  reproduction: {
    prompt: "How can Cloudflare reproduce the issue?",
    guidance:
      "List the shortest repeatable steps, including an example URL, request method, required conditions, and the observed result. Remove credentials and private query values.",
    placeholder: "Example: 1. Open… 2. Submit… 3. Observe…",
  },
  evidence: {
    prompt: "Paste an exact error, Ray ID, or evidence summary.",
    guidance:
      "A Ray ID appears at the bottom of most Cloudflare error pages. Include its matching UTC timestamp. You can also name prepared HAR, screenshot, origin log, curl, dig, or MTR files.",
    placeholder: "Example: Error 522 · Ray ID 49ddb3e70e665831 · screenshot.png",
  },
  originFindings: {
    prompt: "What did you find at the origin?",
    guidance:
      "For P1, record the investigation status even if no logs are available. Check web-server, application, firewall, load balancer, database, and deployment logs at the same UTC time.",
    placeholder: "Example: Origin healthy; no request reached nginx at the failed UTC time",
  },
};

const coreQuestionOrder = [
  "issueType",
  "priority",
  "hostnames",
  "startedUtc",
  "frequency",
  "impact",
  "expected",
  "actual",
  "reproduction",
  "evidence",
];

const fieldLabels = {
  issueType: "Issue",
  priority: "Priority",
  service: "Service",
  hostnames: "Hostname",
  startedUtc: "Started",
  frequency: "Frequency",
  impact: "Impact",
  affectedUsers: "Affected",
  expected: "Expected",
  actual: "Actual",
  reproduction: "Reproduce",
  exactErrors: "Error",
  rayIds: "Ray ID",
  originFindings: "Origin",
};

const evidenceByIssue = {
  outage: ["Origin web-server logs", "curl and MTR output", "Origin health"],
  performance: ["HAR file", "curl timing output", "Origin and database timing"],
  dns: ["dig or nslookup output", "Authoritative nameservers", "DNS record values"],
  ssl: ["openssl output", "Certificate chain", "Cloudflare SSL/TLS mode"],
  security: ["Security Event and rule ID", "Ray ID", "Expected rule behavior"],
  workers: ["Worker name and version", "Workers exception logs", "Deployment timestamp"],
  "zero-trust": ["Product and policy name", "WARP diagnostics", "User and application impact"],
  other: ["Relevant origin logs", "Network diagnostics", "Recent changes"],
};

const localErrorRules = {
  520: ["Unknown response from origin (520)", "origin", "Cloudflare received an empty, unknown, or unexpected origin response.", ["Check origin application logs at the same UTC time.", "Test the origin directly with the affected Host header."]],
  521: ["Origin refused connection (521)", "origin", "The origin refused Cloudflare's connection.", ["Confirm the origin service is listening.", "Allow Cloudflare IP ranges through origin firewalls."]],
  522: ["Origin connection timed out (522)", "origin", "Cloudflare did not complete the connection to the origin in time.", ["Check origin load, firewall drops, and connection limits.", "Collect origin logs and MTR for the failed UTC window."]],
  523: ["Origin is unreachable (523)", "network", "Cloudflare could not route to the configured origin.", ["Confirm the DNS record contains the current origin IP.", "Check routing with the hosting provider."]],
  524: ["Origin response timed out (524)", "application", "Cloudflare connected, but the origin application did not respond before the timeout.", ["Find slow requests in application and database logs.", "Measure direct-origin response time."]],
  525: ["Origin TLS handshake failed (525)", "origin", "TLS negotiation between Cloudflare and the origin failed.", ["Validate origin ciphers, SNI, and certificate configuration.", "Test the origin with openssl."]],
  526: ["Invalid origin certificate (526)", "origin", "Cloudflare could not validate the origin certificate in Full (strict) mode.", ["Confirm certificate validity and hostname coverage.", "Serve the complete certificate chain."]],
  1016: ["Origin DNS error (1016)", "network", "Cloudflare could not resolve the configured origin hostname.", ["Run dig against authoritative nameservers.", "Review CNAME targets and recent DNS changes."]],
  1020: ["Request blocked by a Cloudflare rule (1020)", "cloudflare", "A Cloudflare security rule denied the request.", ["Search Security Events using the Ray ID and UTC timestamp.", "Review the matched rule before changing it."]],
  1101: ["Worker threw an exception (1101)", "application", "A Cloudflare Worker terminated because of an exception.", ["Inspect Workers logs at the same UTC time.", "Review the latest Worker deployment and stack trace."]],
  1102: ["Worker exceeded a resource limit (1102)", "application", "A Cloudflare Worker exceeded a runtime limit.", ["Inspect Workers CPU time and invocation logs.", "Check loops, parsing, and subrequest volume."]],
};

let screenshotDataUrl;
let state = loadState() ?? createInitialState();
let sourceDraft = state.draft || "";
let saveTimer;

initializeConversation();

elements.composer.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = elements.input.value.trim();
  if (!text && !screenshotDataUrl) return;
  elements.input.value = "";
  resizeComposer();
  if (state.phase === "initial") {
    await handleInitialIssue(text);
  } else if (state.currentQuestion) {
    handleQuestionAnswer(text, text);
  }
});

elements.input.addEventListener("input", resizeComposer);
elements.input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    elements.composer.requestSubmit();
  }
});
elements.composer.addEventListener("paste", async (event) => {
  const imageItem = Array.from(event.clipboardData?.items ?? []).find(
    (item) => item.kind === "file" && item.type.startsWith("image/"),
  );
  const file = imageItem?.getAsFile();
  if (!file) return;
  event.preventDefault();
  await attachScreenshot(file, "Pasted screenshot");
});

elements.screenshot.addEventListener("change", async () => {
  const file = elements.screenshot.files?.[0];
  if (!file) return;
  await attachScreenshot(file, file.name);
});

async function attachScreenshot(file, displayName) {
  if (state.phase !== "initial") {
    setStatus(
      "Screenshots are analyzed when starting a case. Start a new case to paste another error image.",
      true,
    );
    elements.screenshot.value = "";
    return;
  }
  if (file.size > MAX_SCREENSHOT_BYTES) {
    setStatus("Screenshot must be 4 MB or smaller.", true);
    removeScreenshot();
    return;
  }
  if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type)) {
    setStatus("Use a PNG, JPG, GIF, or WebP screenshot.", true);
    removeScreenshot();
    return;
  }
  screenshotDataUrl = await readAsDataUrl(file);
  elements.attachmentName.textContent = `${displayName || "Screenshot"} · ${formatBytes(file.size)}`;
  elements.attachmentPreview.hidden = false;
  setStatus(
    "Screenshot attached. It will be analyzed once and will not be stored with the local chat.",
  );
}

elements.removeAttachment.addEventListener("click", removeScreenshot);

elements.clear.addEventListener("click", () => {
  if (!window.confirm("Start a new case and remove this local chat and draft?")) return;
  localStorage.removeItem(STORAGE_KEY);
  state = createInitialState();
  sourceDraft = "";
  removeScreenshot();
  initializeConversation();
});

elements.copyDraft.addEventListener("click", async () => {
  await navigator.clipboard.writeText(elements.draftOutput.value);
  elements.draftStatus.textContent = "Case draft copied.";
});

for (const button of elements.draftLanguageButtons) {
  button.addEventListener("click", async () => {
    if (!sourceDraft) return;
    setDraftButtonsBusy(true);
    elements.draftStatus.textContent = `Translating to ${button.textContent.trim()}…`;
    try {
      const result = await api("/api/translate", {
        method: "POST",
        body: JSON.stringify({
          text: sourceDraft,
          targetLanguage: button.dataset.draftLanguage,
        }),
      });
      elements.draftOutput.value = result.translation;
      setActiveDraftLanguage(button.dataset.draftLanguage);
      elements.draftStatus.textContent =
        "Translation complete. Review technical values before submission.";
    } catch (error) {
      elements.draftStatus.textContent = error.message;
    } finally {
      setDraftButtonsBusy(false);
    }
  });
}

function createInitialState() {
  return {
    phase: "initial",
    messages: [],
    caseData: { issueType: "" },
    evidence: [],
    currentQuestion: "",
    pendingAnalysis: null,
    draft: "",
  };
}

function initializeConversation() {
  if (state.messages.length === 0) {
    addMessage(
      "assistant",
      "Hi — describe the Cloudflare error or issue you are seeing. You can paste the message, URL, Ray ID, logs, or attach a screenshot.",
      "Start with one failed request if possible. Include an affected hostname and UTC timestamp. I will ask only for information that is still missing.",
    );
  }
  renderAll();
  if (state.phase === "questions" && state.currentQuestion) {
    showQuestionControls(state.currentQuestion);
  }
}

async function handleInitialIssue(text) {
  addMessage("user", text || "Attached an error screenshot.");
  setBusy(true);
  setStatus("Analyzing the error and extracting troubleshooting signals…");
  try {
    const analysis = screenshotDataUrl
      ? await api("/api/analyze", {
          method: "POST",
          body: JSON.stringify({
            message: text,
            imageDataUrl: screenshotDataUrl,
          }),
        })
      : analyzeLocally(text);
    state.evidence = analysis.requiredEvidence ?? [];
    inferCaseData(
      text,
      analysis.aiUsed ? { ...analysis, likelyIssue: "", signals: {} } : analysis,
    );
    addMessage(
      "assistant",
      `Likely issue: ${analysis.likelyIssue}\nConfidence: ${analysis.confidence}\n\n${analysis.explanation}`,
      `Next checks:\n${(analysis.nextChecks ?? []).map((item, index) => `${index + 1}. ${item}`).join("\n")}`,
      "diagnosis",
    );
    if (analysis.aiUsed) {
      state.pendingAnalysis = analysis;
      addMessage(
        "assistant",
        `I extracted these screenshot details:\n${analysis.screenshotSummary || "No additional visible details."}\n\nAre these details correct?`,
        "Confirm extracted values before they are used in your case.",
      );
      state.currentQuestion = "confirmScreenshot";
      state.phase = "questions";
      saveState();
      renderAll();
      showQuickReplies([
        { value: "yes", label: "Yes, use them" },
        { value: "no", label: "No, ignore them" },
      ]);
    } else {
      beginQuestions();
    }
  } catch (error) {
    addMessage(
      "assistant",
      `I could not analyze that input: ${error.message}\n\nYou can continue by describing the exact error in text.`,
    );
  } finally {
    removeScreenshot();
    setBusy(false);
    setStatus("");
  }
}

function beginQuestions() {
  state.phase = "questions";
  state.pendingAnalysis = null;
  askNextQuestion();
}

function askNextQuestion() {
  const questionId = findNextQuestion();
  if (!questionId) {
    completeCase();
    return;
  }
  state.currentQuestion = questionId;
  const question = questions[questionId];
  addMessage("assistant", question.prompt, question.guidance);
  saveState();
  renderAll();
  showQuestionControls(questionId);
}

function findNextQuestion() {
  const data = state.caseData;
  const order = [...coreQuestionOrder];
  if (data.priority === "P1") {
    order.splice(2, 0, "service");
    order.splice(7, 0, "affectedUsers");
    order.push("originFindings");
  }
  return order.find((field) => !isFieldComplete(field)) ?? "";
}

function isFieldComplete(field) {
  const data = state.caseData;
  if (field === "evidence") return Boolean(data.exactErrors || data.rayIds);
  return Boolean(data[field]?.trim?.() ?? data[field]);
}

function showQuestionControls(questionId) {
  if (questionId === "confirmScreenshot") {
    showQuickReplies([
      { value: "yes", label: "Yes, use them" },
      { value: "no", label: "No, ignore them" },
    ]);
    return;
  }
  const question = questions[questionId];
  elements.input.placeholder =
    question.placeholder ?? "Type your answer…";
  if (question.options) showQuickReplies(question.options);
  else hideQuickReplies();
  elements.input.focus();
}

function showQuickReplies(options) {
  elements.quickReplies.replaceChildren(
    ...options.map((option) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = option.label;
      button.addEventListener("click", () =>
        handleQuestionAnswer(option.value, option.label),
      );
      return button;
    }),
  );
  elements.quickReplies.hidden = false;
}

function hideQuickReplies() {
  elements.quickReplies.hidden = true;
  elements.quickReplies.replaceChildren();
}

function handleQuestionAnswer(value, displayValue) {
  if (!value) return;
  if (state.currentQuestion === "confirmScreenshot") {
    addMessage("user", displayValue);
    if (value === "yes" && state.pendingAnalysis) {
      inferCaseData("", state.pendingAnalysis);
    }
    state.pendingAnalysis = null;
    state.currentQuestion = "";
    beginQuestions();
    return;
  }

  const questionId = state.currentQuestion;
  const question = questions[questionId];
  if (question.options) {
    const normalized = value.trim().toLowerCase();
    const match = question.options.find(
      (option) =>
        option.value.toLowerCase() === normalized ||
        option.label.toLowerCase() === normalized,
    );
    if (!match) {
      setStatus("Please choose one of the available options.", true);
      return;
    }
    value = match.value;
    displayValue = match.label;
  }
  const normalizedValue = question.normalize?.(value) ?? value;
  const validationError =
    question.validate?.(value, normalizedValue) ?? "";
  if (validationError) {
    setStatus(validationError, true);
    return;
  }

  addMessage("user", displayValue);
  if (questionId === "evidence") {
    state.caseData.exactErrors = value;
    const rayIds = [
      ...value.matchAll(/\b([a-f0-9]{16,32})(?:-[A-Z]{3})?\b/gi),
    ].map((match) => match[1]);
    if (rayIds.length) state.caseData.rayIds = [...new Set(rayIds)].join(", ");
  } else {
    state.caseData[questionId] = normalizedValue;
  }

  if (questionId === "startedUtc" && normalizedValue !== value) {
    addMessage(
      "assistant",
      `I interpreted that as ${normalizedValue}.`,
      "This normalized value will be used to correlate Cloudflare and origin logs.",
    );
  }

  if (questionId === "priority" && value === "P1") {
    addMessage(
      "assistant",
      "P1 selected. Check the Cloudflare Status page first. Enterprise customers with an active severe outage or attack should also use the Emergency hotline tile in the Dashboard.",
      "P1 requires ongoing customer availability plus the affected service, hostname, users, exact error or Ray ID, and origin investigation status.",
      "critical",
    );
  }
  state.currentQuestion = "";
  setStatus("");
  saveState();
  renderAll();
  askNextQuestion();
}

function analyzeLocally(text) {
  const errorCodes = [
    ...new Set(
      [
        ...text.matchAll(
          /(?:error(?:\s+code)?[\s:#-]*|cloudflare\s+)(\d{3,4})\b/gi,
        ),
        ...text.matchAll(/\b(52[0-6]|1016|1020|110[12])\b/g),
      ].map((match) => match[1]).filter(Boolean),
    ),
  ];
  const rayIds = [
    ...new Set(
      [...text.matchAll(/(?:ray(?:\s+id)?[\s:#-]*)([a-f0-9]{16,32})(?:-[A-Z]{3})?/gi)]
        .map((match) => match[1])
        .filter(Boolean),
    ),
  ];
  const hostnames = [
    ...new Set(
      [...text.matchAll(/\b(?:https?:\/\/)?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z]{2,})+)\b/gi)]
        .map((match) => match[1])
        .filter((value) => value && !value.endsWith("cloudflare.com")),
    ),
  ];
  const timestampsUtc = [
    ...new Set(
      [...text.matchAll(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?Z\b/g)].map(
        (match) => match[0],
      ),
    ),
  ];
  const rule = errorCodes.map((code) => localErrorRules[code]).find(Boolean);
  let likelyIssue = "Issue needs more evidence";
  let likelyArea = "unknown";
  let explanation =
    "No known Cloudflare error code was found. I will collect the minimum details needed to investigate.";
  let nextChecks = [
    "Capture one exact error, affected URL, Ray ID, and UTC timestamp.",
    "Compare the failed request with origin logs.",
  ];
  if (rule) {
    [likelyIssue, likelyArea, explanation, nextChecks] = rule;
  } else if (/certificate|ssl|tls/i.test(text)) {
    likelyIssue = "SSL/TLS issue";
    likelyArea = "origin";
    explanation =
      "The description suggests a certificate or TLS negotiation problem.";
    nextChecks = [
      "Capture the exact browser or TLS error.",
      "Test the edge and origin certificates with openssl.",
    ];
  } else if (/dns|nxdomain|resolve/i.test(text)) {
    likelyIssue = "DNS resolution issue";
    likelyArea = "network";
    explanation =
      "The description suggests that a hostname or origin cannot be resolved.";
    nextChecks = [
      "Run dig against authoritative nameservers.",
      "Compare public resolver answers and recent DNS changes.",
    ];
  } else if (/slow|latency|timeout/i.test(text)) {
    likelyIssue = "Performance or timeout issue";
    explanation =
      "The description suggests latency or timeout symptoms, but more evidence is needed to locate the delay.";
    nextChecks = [
      "Record response timing with curl.",
      "Compare proxied and direct-origin performance.",
    ];
  }
  return {
    likelyIssue,
    likelyArea,
    confidence: rule ? "high" : text.length > 40 ? "medium" : "low",
    explanation,
    signals: { errorCodes, rayIds, hostnames, timestampsUtc },
    nextChecks,
    requiredEvidence: [
      "Affected hostname and Zone ID",
      "One failed request timestamp in UTC",
      "Exact error and Ray ID",
      "Origin logs for the same UTC window",
    ],
    needsConfirmation: false,
    aiUsed: false,
    redactions: 0,
  };
}

function inferCaseData(text, analysis) {
  const data = state.caseData;
  applyAnalysisSignals(analysis);
  const lower = `${text} ${analysis.likelyIssue}`.toLowerCase();
  if (!data.issueType) {
    data.issueType =
      lower.includes("worker") || lower.includes("1101") || lower.includes("1102")
        ? "workers"
        : lower.includes("ssl") || lower.includes("tls") || lower.includes("certificate")
          ? "ssl"
          : lower.includes("dns") || lower.includes("1016")
            ? "dns"
            : lower.includes("waf") || lower.includes("blocked") || lower.includes("1020")
              ? "security"
              : lower.includes("slow") || lower.includes("latency")
                ? "performance"
                : /52[0-6]|outage|unavailable|timeout/.test(lower)
                  ? "outage"
                  : "";
  }
  if (!data.service && data.issueType) data.service = issueTypes[data.issueType];
}

function applyAnalysisSignals(analysis) {
  const signals = analysis.signals ?? {};
  if (!state.caseData.hostnames && signals.hostnames?.length) {
    state.caseData.hostnames = signals.hostnames.join(", ");
  }
  if (!state.caseData.startedUtc && signals.timestampsUtc?.length) {
    state.caseData.startedUtc = signals.timestampsUtc[0];
  }
  if (!state.caseData.rayIds && signals.rayIds?.length) {
    state.caseData.rayIds = signals.rayIds.join(", ");
  }
  if (!state.caseData.exactErrors && signals.errorCodes?.length) {
    state.caseData.exactErrors = signals.errorCodes
      .map((code) => `Cloudflare Error ${code}`)
      .join(", ");
  }
  if (!state.caseData.actual && analysis.likelyIssue) {
    state.caseData.actual = analysis.likelyIssue;
  }
}

function completeCase() {
  state.phase = "complete";
  state.currentQuestion = "";
  sourceDraft = generateCaseDraft(state.caseData);
  state.draft = sourceDraft;
  addMessage(
    "assistant",
    "The minimum information is complete. I generated a Support case draft in the case panel.",
    "Review every technical value, attach the listed evidence, and remove any secrets before submission. Cloudflare Support officially handles cases in English.",
  );
  saveState();
  renderAll();
}

function generateCaseDraft(data) {
  const safe = Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      typeof value === "string" ? redactLocalSecrets(value) : value,
    ]),
  );
  const title = `${safe.priority || "[Priority]"} ${safe.service || issueTypes[safe.issueType] || "Cloudflare"} – ${firstLine(safe.actual) || "Issue requiring investigation"}`;
  return `Title: ${title}

Account / zone
- Zone name or affected hostname: ${safe.hostnames || ""}
- Zone ID: ${safe.zoneId || ""}

Impact
- Priority: ${safe.priority || ""}
- Production impact: ${safe.impact || ""}
- Affected users/regions: ${safe.affectedUsers || ""}
- Started (UTC): ${safe.startedUtc || ""}
- Frequency: ${safe.frequency || ""}

Issue
- Expected behavior: ${safe.expected || ""}
- Actual behavior: ${safe.actual || ""}
- Exact error(s): ${safe.exactErrors || ""}
- Steps to reproduce: ${safe.reproduction || ""}

Investigation
- Cloudflare Ray ID(s): ${safe.rayIds || ""}
- Origin/log findings: ${safe.originFindings || "Not yet provided"}

Evidence to attach
${state.evidence.map((item) => `- ${item}`).join("\n")}

Case participants
- CC: `;
}

function redactLocalSecrets(value) {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, "[REDACTED]")
    .replace(
      /\b(?:authorization|api[-_ ]?key|token|password|secret)\s*[:=]\s*\S+/gi,
      "[REDACTED]",
    )
    .replace(
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
      "[REDACTED]",
    );
}

function addMessage(role, text, guidance = "", kind = "guidance") {
  state.messages.push({
    role,
    text,
    guidance,
    kind,
    timestamp: new Date().toISOString(),
  });
  saveState();
}

function renderAll() {
  renderMessages();
  renderProgress();
  renderCollected();
  renderEvidence();
  renderDraft();
}

function renderMessages() {
  elements.messages.replaceChildren(
    ...state.messages.map((message) => {
      const row = document.createElement("div");
      row.className = `message-row ${message.role}`;
      const avatar = document.createElement("div");
      avatar.className = "message-avatar";
      avatar.textContent = message.role === "assistant" ? "CF" : "You";
      const content = document.createElement("div");
      content.className = "message-content";
      const bubble = document.createElement("div");
      bubble.className = "bubble";
      bubble.textContent = message.text;
      content.append(bubble);
      if (message.guidance) {
        const guidance = document.createElement("div");
        guidance.className =
          message.kind === "diagnosis"
            ? "diagnosis-card"
            : message.kind === "critical"
              ? "critical-card"
              : "guidance-card";
        const title = document.createElement("strong");
        title.textContent =
          message.kind === "diagnosis"
            ? "Recommended checks"
            : message.kind === "critical"
              ? "Critical incident guidance"
              : "How to collect this";
        guidance.append(title, document.createTextNode(message.guidance));
        content.append(guidance);
      }
      const time = document.createElement("span");
      time.className = "message-time";
      time.textContent = new Date(message.timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      content.append(time);
      row.append(avatar, content);
      return row;
    }),
  );
  requestAnimationFrame(() => {
    elements.messages.scrollTop = elements.messages.scrollHeight;
  });
}

function requiredFields() {
  const base = [
    ["priority", "Priority"],
    ["hostnames", "Affected zone or hostname"],
    ["startedUtc", "UTC start time"],
    ["frequency", "Frequency"],
    ["impact", "Business impact"],
    ["expected", "Expected result"],
    ["actual", "Actual result"],
    ["reproduction", "Reproduction"],
    ["evidence", "Error or Ray ID"],
  ];
  if (state.caseData.priority === "P1") {
    base.push(
      ["service", "Affected service"],
      ["affectedUsers", "Affected users"],
      ["originFindings", "Origin status"],
    );
  }
  return base;
}

function renderProgress() {
  const required = requiredFields();
  const done = required.filter(([field]) => isFieldComplete(field)).length;
  const score = Math.round((done / required.length) * 100);
  elements.score.textContent = String(score);
  elements.progressBar.style.width = `${score}%`;
  elements.progressRing.style.background = `conic-gradient(var(--orange) ${score}%, #ebe8e3 ${score}%)`;
  elements.readinessCopy.textContent =
    score === 100
      ? "Minimum case requirements complete."
      : `${required.length - done} required answer(s) remaining.`;
}

function renderCollected() {
  const values = Object.entries(state.caseData).filter(
    ([key, value]) => value && fieldLabels[key],
  );
  elements.answerCount.textContent = `${values.length} item${values.length === 1 ? "" : "s"}`;
  if (!values.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Answers will appear here as we chat.";
    elements.collectedList.replaceChildren(empty);
    return;
  }
  elements.collectedList.replaceChildren(
    ...values.map(([key, value]) => {
      const row = document.createElement("div");
      const term = document.createElement("dt");
      const description = document.createElement("dd");
      term.textContent = fieldLabels[key];
      description.textContent =
        key === "issueType" ? issueTypes[value] ?? value : truncate(value, 86);
      row.append(term, description);
      return row;
    }),
  );
}

function renderEvidence() {
  const issueType = state.caseData.issueType || "other";
  const evidence = [
    "Affected hostname and Zone ID",
    "One failed request timestamp in UTC",
    "Exact error and Ray ID",
    "Expected versus actual behavior",
    ...(evidenceByIssue[issueType] ?? evidenceByIssue.other),
  ];
  elements.evidenceList.replaceChildren(
    ...[...new Set([...state.evidence, ...evidence])].map((item) => {
      const row = document.createElement("li");
      row.textContent = item;
      return row;
    }),
  );
}

function renderDraft() {
  if (!state.draft) {
    elements.draftPanel.hidden = true;
    return;
  }
  sourceDraft = state.draft;
  elements.draftOutput.value = state.draft;
  elements.draftPanel.hidden = false;
}

function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const safeState = {
      ...state,
      pendingAnalysis: state.pendingAnalysis
        ? { ...state.pendingAnalysis, screenshotSummary: undefined }
        : null,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(safeState));
  }, 100);
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    return saved?.messages && saved?.caseData ? saved : null;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

function setBusy(busy) {
  elements.send.disabled = busy;
  elements.input.disabled = busy;
}

function setStatus(message, error = false) {
  elements.status.textContent = message;
  elements.status.style.color = error ? "var(--red)" : "";
}

function resizeComposer() {
  elements.input.style.height = "auto";
  elements.input.style.height = `${Math.min(elements.input.scrollHeight, 140)}px`;
}

function removeScreenshot() {
  screenshotDataUrl = undefined;
  elements.screenshot.value = "";
  elements.attachmentPreview.hidden = true;
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read screenshot"));
    reader.readAsDataURL(file);
  });
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message ?? "Request failed");
  return result;
}

function firstLine(value = "") {
  return value.split(/\r?\n/)[0].slice(0, 90);
}

function truncate(value, length) {
  const text = String(value);
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function formatBytes(bytes) {
  return bytes < 1024 * 1024
    ? `${Math.ceil(bytes / 1024)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function setDraftButtonsBusy(busy) {
  for (const button of elements.draftLanguageButtons) button.disabled = busy;
}

function setActiveDraftLanguage(language) {
  for (const button of elements.draftLanguageButtons) {
    button.classList.toggle(
      "active",
      button.dataset.draftLanguage === language,
    );
  }
}

function initializeLanguageMenu() {
  elements.languageMenuToggle.addEventListener("click", () => {
    const open = elements.languageMenuPopover.hidden;
    elements.languageMenuPopover.hidden = !open;
    elements.languageMenuToggle.setAttribute("aria-expanded", String(open));
  });
  for (const button of elements.uiLanguageButtons) {
    button.addEventListener("click", async () => {
      elements.languageMenuPopover.hidden = true;
      elements.languageMenuToggle.setAttribute("aria-expanded", "false");
      await setUiLanguage(button.dataset.uiLanguage);
    });
  }
  document.addEventListener("click", (event) => {
    if (!elements.languageMenu.contains(event.target)) {
      elements.languageMenuPopover.hidden = true;
      elements.languageMenuToggle.setAttribute("aria-expanded", "false");
    }
  });
  initializeUiTranslation();
}

const uiTranslationEntries = captureUiTranslationEntries();
const uiSourceStrings = uiTranslationEntries.map((entry) => entry.original);
const uiSourceHash = hashStrings(uiSourceStrings);

async function initializeUiTranslation() {
  const preferred = localStorage.getItem(UI_LANGUAGE_KEY) ?? "en";
  if (["en", "vi", "km"].includes(preferred)) await setUiLanguage(preferred);
}

async function setUiLanguage(language) {
  const names = { en: "English", vi: "Tiếng Việt", km: "ខ្មែរ" };
  if (!names[language]) return;
  setUiLanguageBusy(true);
  elements.currentLanguage.textContent =
    language === "en" ? names.en : "Translating…";
  try {
    let translations = uiSourceStrings;
    if (language !== "en") {
      const cacheKey = `${UI_TRANSLATION_VERSION}:${language}:${uiSourceHash}`;
      translations = readTranslationCache(cacheKey);
      if (!translations) {
        const result = await api("/api/translate-ui", {
          method: "POST",
          body: JSON.stringify({
            strings: uiSourceStrings,
            targetLanguage: language,
          }),
        });
        translations = result.translations;
        localStorage.setItem(cacheKey, JSON.stringify(translations));
      }
    }
    applyUiTranslations(translations);
    document.documentElement.lang = language;
    localStorage.setItem(UI_LANGUAGE_KEY, language);
    elements.currentLanguage.textContent = names[language];
    for (const button of elements.uiLanguageButtons) {
      button.classList.toggle(
        "active",
        button.dataset.uiLanguage === language,
      );
    }
  } catch (error) {
    elements.currentLanguage.textContent = names.en;
    setStatus(`Interface translation unavailable: ${error.message}`, true);
  } finally {
    setUiLanguageBusy(false);
  }
}

function captureUiTranslationEntries() {
  const entries = [];
  const blocked = [
    "script",
    "style",
    "textarea",
    "input",
    ".language-menu",
    ".messages",
    ".collected-list",
    ".evidence-panel",
    ".draft-panel",
    ".composer-status",
    "[data-no-translate]",
  ].join(",");
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node.nodeValue?.trim() ?? "";
      return text &&
        /[A-Za-z]/.test(text) &&
        node.parentElement &&
        !node.parentElement.closest(blocked)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
  let node;
  while ((node = walker.nextNode())) {
    const full = node.nodeValue ?? "";
    entries.push({
      kind: "text",
      node,
      original: full.trim(),
      leading: full.match(/^\s*/)?.[0] ?? "",
      trailing: full.match(/\s*$/)?.[0] ?? "",
    });
  }
  for (const element of document.querySelectorAll(
    "input[placeholder], textarea[placeholder]",
  )) {
    const original = element.getAttribute("placeholder")?.trim();
    if (original && /[A-Za-z]/.test(original)) {
      entries.push({
        kind: "attribute",
        element,
        attribute: "placeholder",
        original,
      });
    }
  }
  return entries;
}

function applyUiTranslations(translations) {
  if (!Array.isArray(translations) || translations.length !== uiTranslationEntries.length) {
    throw new Error("Cached translation does not match this page version");
  }
  uiTranslationEntries.forEach((entry, index) => {
    const translated = translations[index];
    if (typeof translated !== "string") return;
    if (entry.kind === "text") {
      entry.node.nodeValue = `${entry.leading}${translated}${entry.trailing}`;
    } else {
      entry.element.setAttribute(entry.attribute, translated);
    }
  });
}

function readTranslationCache(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null");
    return Array.isArray(value) &&
      value.length === uiTranslationEntries.length &&
      value.every((item) => typeof item === "string")
      ? value
      : undefined;
  } catch {
    localStorage.removeItem(key);
    return undefined;
  }
}

function setUiLanguageBusy(busy) {
  elements.languageMenuToggle.disabled = busy;
  for (const button of elements.uiLanguageButtons) button.disabled = busy;
}

function hashStrings(values) {
  let hash = 2166136261;
  for (const character of values.join("\u241f")) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

initializeLanguageMenu();
