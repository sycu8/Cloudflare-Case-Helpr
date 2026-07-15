const STORAGE_KEY = "cf-support-case-helper-v1";
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
  copy: document.querySelector("#copy-draft"),
  copyStatus: document.querySelector("#copy-status"),
  clear: document.querySelector("#clear-data"),
  saveState: document.querySelector("#save-state"),
};

let screenshotDataUrl;
let pendingScreenshotAnalysis;
let saveTimer;

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

restoreDraft();
updateEvidence();
updateProgress();

elements.message.addEventListener("input", scheduleSave);
elements.form.addEventListener("input", () => {
  scheduleSave();
  updateProgress();
});
elements.form.elements.priority.addEventListener("change", () => {
  elements.p1Alert.hidden = elements.form.elements.priority.value !== "P1";
});
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

elements.analyze.addEventListener("click", async () => {
  if (!elements.message.value.trim() && !screenshotDataUrl) {
    setStatus(elements.analyzeStatus, "Describe the issue or add a screenshot.", true);
    elements.message.focus();
    return;
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
  } catch (error) {
    setStatus(elements.analyzeStatus, error.message, true);
  } finally {
    setBusy(elements.analyze, false, "Analyze issue");
  }
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

elements.generate.addEventListener("click", async () => {
  setBusy(elements.generate, true, "Checking…");
  try {
    const result = await api("/api/case/draft", {
      method: "POST",
      body: JSON.stringify(caseData()),
    });
    renderValidation(result.validation);
    elements.draftOutput.value = result.body;
    elements.draftWrap.hidden = false;
    elements.draftOutput.focus();
  } catch (error) {
    elements.validation.textContent = error.message;
    elements.validation.className = "validation-message warning";
  } finally {
    setBusy(elements.generate, false, "Generate case draft");
  }
});

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
  elements.zonePicker.hidden = true;
  elements.p1Alert.hidden = true;
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

async function updateEvidence() {
  try {
    const issueType = elements.form.elements.issueType.value || "other";
    const result = await api(`/api/evidence?issue_type=${encodeURIComponent(issueType)}`);
    fillList(elements.issueEvidence, result.evidence);
  } catch {
    fillList(elements.issueEvidence, ["Collect relevant Cloudflare and origin evidence."]);
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
  };
  const done = Object.values(complete).filter(Boolean).length;
  const score = Math.round((done / requiredFields.length) * 100);
  elements.score.textContent = String(score);
  elements.progressBar.style.width = `${score}%`;
  elements.progressRing.style.background = `conic-gradient(var(--orange) ${score}%, #ebe8e3 ${score}%)`;
  elements.progressSummary.textContent =
    score === 100
      ? "Core case information is complete."
      : `${requiredFields.length - done} required item(s) remaining.`;

  elements.checklist.replaceChildren(
    ...requiredFields.map(([key, label]) => {
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
    elements.p1Alert.hidden = elements.form.elements.priority.value !== "P1";
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

function formatBytes(bytes) {
  return bytes < 1024 * 1024
    ? `${Math.ceil(bytes / 1024)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
