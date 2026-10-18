const STORAGE_KEY = "cf-support-case-helper-v1";
const UI_LANGUAGE_KEY = "cf-support-ui-language";
const UI_TRANSLATION_VERSION = "v1";
const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024;

const elements = {
  form: document.querySelector("#case-form"),
  message: document.querySelector("#issue-message"),
  screenshot: document.querySelector("#screenshot"),
  fileChip: document.querySelector("#file-chip"),
  fileName: document.querySelector("#file-name"),
  removeFile: document.querySelector("#remove-file"),
  analyze: document.querySelector("#analyze"),
  analyzeStatus: document.querySelector("#analyze-status"),
  diagnosis: document.querySelector("#diagnosis"),
  diagnosisTitle: document.querySelector("#diagnosis-title"),
  diagnosisExplanation: document.querySelector("#diagnosis-explanation"),
  confidence: document.querySelector("#confidence"),
  nextChecks: document.querySelector("#next-checks"),
  analysisEvidence: document.querySelector("#analysis-evidence"),
  screenshotWrap: document.querySelector("#screenshot-summary-wrap"),
  screenshotSummary: document.querySelector("#screenshot-summary"),
  confirmExtraction: document.querySelector("#confirm-extraction"),
  apiToken: document.querySelector("#api-token"),
  connect: document.querySelector("#connect"),
  connectStatus: document.querySelector("#connect-status"),
  zonePicker: document.querySelector("#zone-picker"),
  zoneSelect: document.querySelector("#zone-select"),
  p1Alert: document.querySelector("#p1-alert"),
  score: document.querySelector("#score"),
  progressRing: document.querySelector("#progress-ring"),
  progressBar: document.querySelector("#progress-bar"),
  progressSummary: document.querySelector("#progress-summary"),
  checklist: document.querySelector("#checklist"),
  issueEvidence: document.querySelector("#issue-evidence"),
  validation: document.querySelector("#validation-message"),
  generate: document.querySelector("#generate-draft"),
  draftWrap: document.querySelector("#draft-wrap"),
  draftOutput: document.querySelector("#draft-output"),
  languageButtons: document.querySelectorAll(".language-button"),
  copy: document.querySelector("#copy-draft"),
  copyStatus: document.querySelector("#copy-status"),
  clear: document.querySelector("#clear-data"),
  saveState: document.querySelector("#save-state"),
  languageMenu: document.querySelector("#language-menu"),
  languageMenuToggle: document.querySelector("#language-menu-toggle"),
  languageMenuPopover: document.querySelector("#language-menu-popover"),
  currentLanguage: document.querySelector("#current-language"),
  uiLanguageButtons: document.querySelectorAll("[data-ui-language]"),
};

let screenshotDataUrl;
let pendingScreenshotAnalysis;
let sourceDraft;
let saveTimer;
const uiTranslationEntries = captureUiTranslationEntries();
const uiSourceStrings = uiTranslationEntries.map((entry) => entry.original);
const uiSourceHash = hashStrings(uiSourceStrings);

const requiredFields = [
  ["priority", "Priority"],
  ["zoneOrHost", "Affected zone or hostname"],
  ["startedUtc", "Start timestamp in UTC"],
  ["impact", "Business impact"],
  ["frequency", "Problem frequency"],
  ["expected", "Expected result"],
  ["actual", "Actual result"],
  ["reproduction", "Steps to reproduce"],
  ["evidence", "Error, Ray ID, or attachment"],
];
const criticalRequiredFields = [
  ["service", "Affected Cloudflare service (P1)"],
  ["hostname", "Affected hostname (P1)"],
  ["affectedUsers", "Affected users or regions (P1)"],
  ["exactOrRay", "Exact error or Ray ID (P1)"],
  ["originStatus", "Origin investigation status (P1)"],
];

restoreDraft();
updateEvidence();
updateProgress();
initializeUiLanguage();

elements.languageMenuToggle.addEventListener("click", () => {
  const willOpen = elements.languageMenuPopover.hidden;
  elements.languageMenuPopover.hidden = !willOpen;
  elements.languageMenuToggle.setAttribute("aria-expanded", String(willOpen));
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

elements.message.addEventListener("input", scheduleSave);
elements.form.addEventListener("input", () => {
  scheduleSave();
  updateProgress();
});
elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  void generateDraft();
});
elements.form.elements.priority.addEventListener("change", updateCriticalState);
elements.form.elements.issueType.addEventListener("change", updateEvidence);

elements.screenshot.addEventListener("change", async () => {
  const file = elements.screenshot.files?.[0];
  if (!file) return;
  if (file.size > MAX_SCREENSHOT_BYTES) {
    setStatus(elements.analyzeStatus, "Screenshot must be 4 MB or smaller.", true);
    removeScreenshot();
    return;
  }
  if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type)) {
    setStatus(elements.analyzeStatus, "Use a PNG, JPG, GIF, or WebP image.", true);
    removeScreenshot();
    return;
  }
  screenshotDataUrl = await readAsDataUrl(file);
  elements.fileName.textContent = `${file.name} · ${formatBytes(file.size)}`;
  elements.fileChip.hidden = false;
  setStatus(elements.analyzeStatus, "Screenshot is used for this analysis only.");
});

elements.removeFile.addEventListener("click", removeScreenshot);

elements.analyze.addEventListener("click", () => {
  void analyzeIssue();
});

elements.confirmExtraction.addEventListener("change", () => {
  if (elements.confirmExtraction.checked && pendingScreenshotAnalysis) {
    applySignals(pendingScreenshotAnalysis);
    pendingScreenshotAnalysis = undefined;
    setStatus(elements.analyzeStatus, "Confirmed details added to your draft.");
  }
});

elements.connect.addEventListener("click", async () => {
  const token = elements.apiToken.value.trim();
  if (!token) {
    setStatus(elements.connectStatus, "Enter a read-only API token.", true);
    return;
  }
  setBusy(elements.connect, true, "Connecting…");
  setStatus(elements.connectStatus, "Verifying token…");
  try {
    await api("/api/cloudflare/connection", {
      headers: { "X-Cloudflare-API-Token": token },
    });
    const { zones } = await api("/api/cloudflare/zones", {
      headers: { "X-Cloudflare-API-Token": token },
    });
    renderZones(Array.isArray(zones) ? zones : []);
    setStatus(
      elements.connectStatus,
      `Connected. ${Array.isArray(zones) ? zones.length : 0} zone(s) available.`,
    );
  } catch (error) {
    setStatus(elements.connectStatus, error.message, true);
  } finally {
    setBusy(elements.connect, false, "Connect");
  }
});

elements.zoneSelect.addEventListener("change", () => {
  const option = elements.zoneSelect.selectedOptions[0];
  if (!option?.value) return;
  elements.form.elements.zoneId.value = option.value;
  elements.form.elements.zoneName.value = option.dataset.name ?? "";
  scheduleSave();
  updateProgress();
});

elements.generate.addEventListener("click", () => {
  void generateDraft();
});

for (const button of elements.languageButtons) {
  button.addEventListener("click", async () => {
    if (!sourceDraft) return;
    setLanguageButtonsBusy(true);
    setStatus(elements.copyStatus, `Translating to ${button.textContent.trim()}…`);
    try {
      const result = await api("/api/translate", {
        method: "POST",
        body: JSON.stringify({
          text: sourceDraft,
          targetLanguage: button.dataset.language,
        }),
      });
      elements.draftOutput.value = result.translation;
      setActiveLanguage(button.dataset.language);
      setStatus(
        elements.copyStatus,
        `Draft translated to ${button.textContent.trim()}. Review technical details before submission.`,
      );
    } catch (error) {
      setStatus(elements.copyStatus, error.message, true);
    } finally {
      setLanguageButtonsBusy(false);
    }
  });
}

elements.copy.addEventListener("click", async () => {
  await navigator.clipboard.writeText(elements.draftOutput.value);
  setStatus(elements.copyStatus, "Draft copied.");
});

elements.clear.addEventListener("click", () => {
  if (!window.confirm("Clear the issue, evidence, token, and saved draft from this browser?")) {
    return;
  }
  localStorage.removeItem(STORAGE_KEY);
  elements.form.reset();
  elements.message.value = "";
  elements.apiToken.value = "";
  elements.diagnosis.hidden = true;
  elements.draftWrap.hidden = true;
  sourceDraft = undefined;
  elements.zonePicker.hidden = true;
  updateCriticalState();
  removeScreenshot();
  updateEvidence();
  updateProgress();
  setStatus(elements.saveState, "All local data cleared.");
});

function renderAnalysis(analysis) {
  elements.diagnosisTitle.textContent = analysis.likelyIssue;
  elements.diagnosisExplanation.textContent = analysis.explanation;
  elements.confidence.textContent = `${analysis.confidence} confidence`;
  fillList(elements.nextChecks, analysis.nextChecks);
  fillList(elements.analysisEvidence, analysis.requiredEvidence);
  elements.screenshotWrap.hidden = !analysis.screenshotSummary;
  elements.screenshotSummary.textContent = analysis.screenshotSummary ?? "";
  elements.confirmExtraction.checked = false;
  elements.diagnosis.hidden = false;
}

function applySignals(analysis) {
  const { signals } = analysis;
  setIfEmpty("hostnames", signals.hostnames.join(", "));
  setIfEmpty("rayIds", signals.rayIds.join(", "));
  setIfEmpty("exactErrors", signals.errorCodes.map((code) => `Cloudflare Error ${code}`).join("\n"));
  if (signals.timestampsUtc[0] && !elements.form.elements.startedUtc.value) {
    elements.form.elements.startedUtc.value = signals.timestampsUtc[0]
      .replace("Z", "")
      .slice(0, 16);
  }
  setIfEmpty("actual", analysis.likelyIssue);
  scheduleSave();
  updateProgress();
}

function setIfEmpty(name, value) {
  if (value && !elements.form.elements[name].value) {
    elements.form.elements[name].value = value;
  }
}

async function analyzeIssue() {
  if (!elements.message.value.trim() && !screenshotDataUrl) {
    setStatus(elements.analyzeStatus, "Describe the issue or add a screenshot.", true);
    elements.message.focus();
    return { error: "Describe the issue or add a screenshot." };
  }
  setBusy(elements.analyze, true, "Analyzing…");
  setStatus(elements.analyzeStatus, "Looking for error codes and request details…");
  try {
    const analysis = await api("/api/analyze", {
      method: "POST",
      body: JSON.stringify({
        message: elements.message.value,
        ...(screenshotDataUrl ? { imageDataUrl: screenshotDataUrl } : {}),
      }),
    });
    renderAnalysis(analysis);
    if (analysis.aiUsed) {
      pendingScreenshotAnalysis = analysis;
    } else {
      applySignals(analysis);
    }
    const redactionMessage = analysis.redactions
      ? ` ${analysis.redactions} possible secret value(s) were redacted.`
      : "";
    setStatus(elements.analyzeStatus, `Analysis complete.${redactionMessage}`);
    return analysis;
  } catch (error) {
    setStatus(elements.analyzeStatus, error.message, true);
    return { error: error.message };
  } finally {
    setBusy(elements.analyze, false, "Analyze issue");
  }
}

async function generateDraft() {
  setBusy(elements.generate, true, "Checking…");
  try {
    const result = await api("/api/case/draft", {
      method: "POST",
      body: JSON.stringify(caseData()),
    });
    renderValidation(result.validation);
    sourceDraft = result.body;
    elements.draftOutput.value = result.body;
    setActiveLanguage();
    elements.draftWrap.hidden = false;
    elements.draftOutput.focus();
    return result;
  } catch (error) {
    elements.validation.textContent = error.message;
    elements.validation.className = "validation-message warning";
    return { error: error.message };
  } finally {
    setBusy(elements.generate, false, "Generate case draft");
  }
}

async function updateEvidence() {
  try {
    const issueType = elements.form.elements.issueType.value || "other";
    const result = await api(`/api/evidence?issue_type=${encodeURIComponent(issueType)}`);
    fillList(elements.issueEvidence, result.evidence);
    return result;
  } catch {
    fillList(elements.issueEvidence, ["Collect relevant Cloudflare and origin evidence."]);
    return { error: "Could not load the evidence checklist." };
  }
}

function updateProgress() {
  const data = caseData();
  const complete = {
    priority: Boolean(data.priority),
    zoneOrHost: Boolean(data.zoneName || data.hostnames),
    startedUtc: Boolean(data.startedUtc),
    impact: Boolean(data.impact),
    frequency: Boolean(data.frequency),
    expected: Boolean(data.expected),
    actual: Boolean(data.actual),
    reproduction: Boolean(data.reproduction),
    evidence: Boolean(data.exactErrors || data.rayIds || data.attachments),
    service: Boolean(data.service),
    hostname: Boolean(data.hostnames),
    affectedUsers: Boolean(data.affectedUsers),
    exactOrRay: Boolean(data.exactErrors || data.rayIds),
    originStatus: Boolean(data.originFindings),
  };
  const fields =
    data.priority === "P1"
      ? [...requiredFields, ...criticalRequiredFields]
      : requiredFields;
  const done = fields.filter(([key]) => complete[key]).length;
  const score = Math.round((done / fields.length) * 100);
  elements.score.textContent = String(score);
  elements.progressBar.style.width = `${score}%`;
  elements.progressRing.style.background = `conic-gradient(var(--orange) ${score}%, #ebe8e3 ${score}%)`;
  elements.progressSummary.textContent =
    score === 100
      ? "Core case information is complete."
      : `${fields.length - done} required item(s) remaining.`;

  elements.checklist.replaceChildren(
    ...fields.map(([key, label]) => {
      const item = document.createElement("li");
      item.textContent = label;
      if (complete[key]) item.className = "done";
      return item;
    }),
  );
}

function caseData() {
  const values = Object.fromEntries(new FormData(elements.form).entries());
  const data = Object.fromEntries(
    Object.entries(values)
      .map(([key, value]) => [key, String(value).trim()])
      .filter(([, value]) => value),
  );
  if (data.startedUtc) data.startedUtc = `${data.startedUtc}:00Z`;
  return data;
}

function renderValidation(validation) {
  const messages = [];
  if (validation.missing.length) {
    messages.push(`Missing: ${validation.missing.join(", ")}.`);
  } else {
    messages.push("Core case information is complete.");
  }
  if (validation.warnings.length) messages.push(...validation.warnings);
  elements.validation.textContent = messages.join(" ");
  elements.validation.className = `validation-message ${
    validation.warnings.length ? "warning" : validation.ready ? "ready" : ""
  }`;
}

function renderZones(zones) {
  elements.zoneSelect.replaceChildren(new Option("Choose a zone", ""));
  for (const zone of zones) {
    if (!zone || typeof zone.id !== "string" || typeof zone.name !== "string") continue;
    const option = new Option(zone.name, zone.id);
    option.dataset.name = zone.name;
    elements.zoneSelect.add(option);
  }
  elements.zonePicker.hidden = false;
}

function fillList(list, values) {
  list.replaceChildren(
    ...(values ?? []).map((value) => {
      const item = document.createElement("li");
      item.textContent = value;
      return item;
    }),
  );
}

function scheduleSave() {
  clearTimeout(saveTimer);
  setStatus(elements.saveState, "Saving…");
  saveTimer = setTimeout(() => {
    const form = Object.fromEntries(new FormData(elements.form).entries());
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ message: elements.message.value, form }),
    );
    setStatus(elements.saveState, "Saved on this device");
  }, 350);
}

function restoreDraft() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!saved) return;
    elements.message.value = saved.message ?? "";
    for (const [name, value] of Object.entries(saved.form ?? {})) {
      if (elements.form.elements[name]) elements.form.elements[name].value = value;
    }
    updateCriticalState();
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function removeScreenshot() {
  screenshotDataUrl = undefined;
  pendingScreenshotAnalysis = undefined;
  elements.screenshot.value = "";
  elements.fileChip.hidden = true;
  elements.confirmExtraction.checked = false;
}

function updateCriticalState() {
  const isCritical = elements.form.elements.priority.value === "P1";
  elements.p1Alert.hidden = !isCritical;
  document.body.classList.toggle("is-critical", isCritical);
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

function setStatus(element, message, error = false) {
  element.textContent = message;
  element.style.color = error ? "var(--red)" : "";
}

function setBusy(button, busy, text) {
  button.disabled = busy;
  button.textContent = text;
}

function setLanguageButtonsBusy(busy) {
  for (const button of elements.languageButtons) button.disabled = busy;
}

function setActiveLanguage(language) {
  for (const button of elements.languageButtons) {
    button.classList.toggle("active", button.dataset.language === language);
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
    ".language-buttons",
    ".action-status",
    "#diagnosis",
    "#checklist",
    "#issue-evidence",
    "#progress-summary",
    "#validation-message",
    "#draft-output",
    "[data-no-translate]",
  ].join(",");
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const value = node.nodeValue?.trim() ?? "";
      const parent = node.parentElement;
      if (
        !value ||
        !/[A-Za-z]/.test(value) ||
        !parent ||
        parent.closest(blocked)
      ) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let node;
  while ((node = walker.nextNode())) {
    const fullValue = node.nodeValue ?? "";
    const original = fullValue.trim();
    entries.push({
      kind: "text",
      node,
      original,
      leading: fullValue.match(/^\s*/)?.[0] ?? "",
      trailing: fullValue.match(/\s*$/)?.[0] ?? "",
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

async function initializeUiLanguage() {
  const preferred = localStorage.getItem(UI_LANGUAGE_KEY) ?? "en";
  if (["en", "vi", "km"].includes(preferred)) {
    await setUiLanguage(preferred);
  }
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
      const cached = readUiTranslationCache(cacheKey);
      if (cached) {
        translations = cached;
      } else {
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
    setStatus(elements.saveState, `Translation unavailable: ${error.message}`, true);
  } finally {
    setUiLanguageBusy(false);
  }
}

function applyUiTranslations(translations) {
  if (!Array.isArray(translations) || translations.length !== uiTranslationEntries.length) {
    throw new Error("Cached translation does not match this page version");
  }
  uiTranslationEntries.forEach((entry, index) => {
    const translation = translations[index];
    if (typeof translation !== "string") return;
    if (entry.kind === "text") {
      entry.node.nodeValue = `${entry.leading}${translation}${entry.trailing}`;
    } else {
      entry.element.setAttribute(entry.attribute, translation);
    }
  });
}

function readUiTranslationCache(cacheKey) {
  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey) ?? "null");
    return Array.isArray(cached) &&
      cached.length === uiTranslationEntries.length &&
      cached.every((value) => typeof value === "string")
      ? cached
      : undefined;
  } catch {
    localStorage.removeItem(cacheKey);
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

function formatBytes(bytes) {
  return bytes < 1024 * 1024
    ? `${Math.ceil(bytes / 1024)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const caseFieldSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    issueType: { type: "string", description: "Issue category such as outage, dns, ssl, or workers." },
    priority: { type: "string", description: "P1, P2, P3, or P4." },
    service: { type: "string", description: "Affected Cloudflare product." },
    startedUtc: { type: "string", description: "Start time as YYYY-MM-DDTHH:mm." },
    zoneName: { type: "string", description: "Zone name, such as example.com." },
    zoneId: { type: "string", description: "32-character zone ID." },
    hostnames: { type: "string", description: "Affected hostnames." },
    frequency: { type: "string", description: "How often the problem happens." },
    affectedUsers: { type: "string", description: "Who is affected." },
    impact: { type: "string", description: "Production and business impact." },
    expected: { type: "string", description: "Expected behavior." },
    actual: { type: "string", description: "Actual behavior." },
    reproduction: { type: "string", description: "Steps to reproduce." },
    exampleUrls: { type: "string", description: "Example URLs without sensitive query parameters." },
    exactErrors: { type: "string", description: "Exact error text." },
    rayIds: { type: "string", description: "Cloudflare Ray IDs." },
    recentChanges: { type: "string", description: "Recent configuration or origin changes." },
    originFindings: { type: "string", description: "Origin findings with UTC timestamps, not secrets." },
    attachments: { type: "string", description: "Prepared attachment filenames." },
    participants: { type: "string", description: "People to copy on the case." },
  },
};

function applyCaseFields(input) {
  if (!input || typeof input !== "object") return;
  for (const [name, value] of Object.entries(input)) {
    const control = elements.form.elements[name];
    if (!control || value == null) continue;
    control.value = String(value);
  }
  updateCriticalState();
  scheduleSave();
  updateProgress();
}

function registerWebMcpTools() {
  const modelContext = document.modelContext ?? navigator.modelContext;
  if (!modelContext || typeof modelContext.registerTool !== "function") return;

  const controller = new AbortController();
  window.addEventListener("pagehide", () => controller.abort(), { once: true });
  const options = { signal: controller.signal };
  const tools = [
    {
      name: "analyze_cloudflare_issue",
      description:
        "Analyze a Cloudflare error description on this page and show the likely issue, next checks, and evidence. Do not include secrets.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          message: {
            type: "string",
            description: "Error text, affected URL, Ray ID, and UTC timestamp.",
          },
        },
        required: ["message"],
      },
      async execute(input) {
        elements.message.value = String(input?.message ?? "");
        scheduleSave();
        return analyzeIssue();
      },
    },
    {
      name: "get_case_evidence",
      description: "Show the Cloudflare and origin evidence checklist for an issue category.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          issueType: {
            type: "string",
            description: "outage, performance, dns, ssl, security, workers, zero-trust, or other.",
          },
        },
      },
      async execute(input) {
        applyCaseFields({ issueType: input?.issueType || "other" });
        return updateEvidence();
      },
    },
    {
      name: "generate_support_case_draft",
      description:
        "Write the incident fields into the case form and generate a copy-ready Cloudflare Support draft. Never include API tokens or other secrets.",
      inputSchema: caseFieldSchema,
      async execute(input) {
        applyCaseFields(input);
        return generateDraft();
      },
    },
  ];

  for (const tool of tools) {
    Promise.resolve(modelContext.registerTool(tool, options)).catch((error) => {
      console.error("WebMCP tool registration failed", error);
    });
  }
}

try {
  registerWebMcpTools();
} catch (error) {
  console.error("WebMCP setup failed", error);
}
