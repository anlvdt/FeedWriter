// === THEME ===
async function initTheme() {
  try {
    const { theme } = await chrome.storage.sync.get({ theme: "light" });
    applyTheme(theme);
    const themeSelect = document.getElementById("themeSelect");
    if (themeSelect) themeSelect.value = theme;
  } catch (e) {
    console.warn("[FeedWriter] initTheme failed", e);
    applyTheme("light");
  }
}

function applyTheme(theme) {
  let isLight = false;
  if (theme === "auto") {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    isLight = !prefersDark;
  } else if (theme === "light") {
    isLight = true;
  }
  document.body.classList.toggle("light", isLight);
  document.documentElement.classList.toggle("light", isLight);
}

const themeSelect = document.getElementById("themeSelect");
if (themeSelect) {
  themeSelect.addEventListener("change", async () => {
    const theme = themeSelect.value;
    try {
      await chrome.storage.sync.set({ theme });
    } catch (_) {}
    applyTheme(theme);
  });
}

try {
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", async () => {
      try {
        const { theme } = await chrome.storage.sync.get({ theme: "light" });
        if (theme === "auto") applyTheme("auto");
      } catch (_) {}
    });
} catch (_) {}

initTheme();

// === SETUP WIZARD ===
function showMainApp() {
  const mainView = document.getElementById("main-view");
  const wizardView = document.getElementById("wizard-view");
  if (wizardView) {
    wizardView.style.display = "none";
    wizardView.hidden = true;
  }
  if (mainView) {
    mainView.style.display = "block";
    mainView.hidden = false;
  }
  try {
    if (typeof loadKeyLists === "function") loadKeyLists();
  } catch (_) {}
}

async function finishWizard() {
  try {
    await chrome.storage.local.set({ wizardCompleted: true });
  } catch (e) {
    console.warn("[FeedWriter] could not persist wizardCompleted", e);
  }
  showMainApp();
  await maybeOpenKeysTabIfNoKeys();
}

async function checkWizardStatus() {
  const mainView = document.getElementById("main-view");
  const wizardView = document.getElementById("wizard-view");
  let completed = false;
  try {
    const data = await chrome.storage.local.get("wizardCompleted");
    completed = !!data.wizardCompleted;
  } catch (e) {
    // Storage/SW broken → don't trap user on wizard forever
    console.warn("[FeedWriter] wizard storage read failed — show main app", e);
    completed = true;
  }

  if (!completed && wizardView) {
    if (mainView) {
      mainView.style.display = "none";
      mainView.hidden = true;
    }
    wizardView.style.display = "block";
    wizardView.hidden = false;
    initWizard();
  } else {
    showMainApp();
    await maybeOpenKeysTabIfNoKeys();
  }
}

function initWizard() {
  const wizardView = document.getElementById("wizard-view");
  if (!wizardView || wizardView.dataset.wizardReady === "1") return;
  wizardView.dataset.wizardReady = "1";

  let currentStep = 0;
  const totalSteps = 4;
  const progressDots = wizardView.querySelectorAll(".wizard-progress-dot");
  const steps = wizardView.querySelectorAll(".wizard-step");

  function goToStep(stepIndex) {
    if (stepIndex < 0 || stepIndex >= totalSteps) return;
    currentStep = stepIndex;

    progressDots.forEach((dot, index) => {
      dot.classList.remove("active", "completed");
      if (index < currentStep) {
        dot.classList.add("completed");
      } else if (index === currentStep) {
        dot.classList.add("active");
      }
      if (index === currentStep) {
        dot.setAttribute("aria-current", "step");
      } else {
        dot.removeAttribute("aria-current");
      }
    });

    steps.forEach((step, index) => {
      const on = index === currentStep;
      step.style.display = on ? "block" : "none";
      step.classList.toggle("active", on);
      step.hidden = !on;
    });

    const live = document.getElementById("wizardStepLive");
    if (live) {
      live.textContent = "Bước " + (currentStep + 1) + "/" + totalSteps;
    }

    const activeStep = steps[currentStep];
    const heading = activeStep?.querySelector("h2");
    if (heading) {
      heading.setAttribute("tabindex", "-1");
      requestAnimationFrame(() => heading.focus({ preventScroll: true }));
    }
  }

  const wizardApiKey = document.getElementById("wizardApiKey");
  const wizardKeyStatus = document.getElementById("wizardKeyStatus");

  function showWizardStatus(msg, type) {
    if (!wizardKeyStatus) return;
    wizardKeyStatus.textContent = msg;
    wizardKeyStatus.className = "status " + (type || "info");
    wizardKeyStatus.hidden = false;
  }

  async function saveWizardApiKey(key) {
    try {
      const providers =
        typeof ALL_PROVIDERS !== "undefined"
          ? ALL_PROVIDERS
          : ["groq", "gemini", "cerebras", "sambanova", "openrouter"];
      const provider =
        typeof detectProvider === "function" ? detectProvider(key) : "groq";
      const data = await chrome.storage.sync.get(["apiKeys"]);
      const apiKeys = data.apiKeys || {};
      for (const p of providers) {
        if (!apiKeys[p]) apiKeys[p] = [];
      }
      if (apiKeys[provider].includes(key)) {
        showWizardStatus("Key đã tồn tại", "info");
        return true;
      }
      apiKeys[provider].push(key);
      await chrome.storage.sync.set({ apiKeys });
      await chrome.storage.local.set({ backupApiKeys: apiKeys });
      showWizardStatus("Đã thêm " + provider.toUpperCase() + " key", "success");
      return true;
    } catch (e) {
      console.error(e);
      showWizardStatus("Không lưu được key — thử lại hoặc Bỏ qua", "error");
      return false;
    }
  }

  async function saveWizardSettings() {
    try {
      const outputLanguage =
        document.getElementById("wizardOutputLanguage")?.value || "vi";
      const summaryLength =
        document.getElementById("wizardSummaryLength")?.value || "medium";
      await chrome.storage.sync.set({
        outputLanguage,
        summaryLength,
        languageAutoDetected: false,
      });
      return true;
    } catch (e) {
      console.error(e);
      return true; // still allow finish
    }
  }

  // Event delegation — survives re-renders / density CSS issues
  wizardView.addEventListener("click", async (e) => {
    const btn = e.target.closest("button, [data-wizard-action]");
    if (!btn || !wizardView.contains(btn)) return;
    const id = btn.id || btn.getAttribute("data-wizard-action") || "";

    if (id === "wizardStep0Next" || id === "wizardStep0Skip") {
      e.preventDefault();
      if (id === "wizardStep0Skip") {
        await finishWizard();
        return;
      }
      goToStep(1);
      return;
    }
    if (id === "wizardStep1Back") {
      e.preventDefault();
      goToStep(0);
      return;
    }
    if (id === "wizardStep1Skip") {
      e.preventDefault();
      goToStep(2);
      return;
    }
    if (id === "wizardStep1Next") {
      e.preventDefault();
      const key = wizardApiKey ? wizardApiKey.value.trim() : "";
      if (!key) {
        showWizardStatus("Vui lòng nhập API key hoặc bấm Bỏ qua", "info");
        return;
      }
      const saved = await saveWizardApiKey(key);
      if (saved) goToStep(2);
      return;
    }
    if (id === "wizardStep2Back") {
      e.preventDefault();
      goToStep(1);
      return;
    }
    if (id === "wizardStep2Next") {
      e.preventDefault();
      await saveWizardSettings();
      goToStep(3);
      return;
    }
    if (id === "wizardStep3Finish") {
      e.preventDefault();
      await finishWizard();
      return;
    }
  });

  if (wizardApiKey) {
    wizardApiKey.addEventListener("input", () => {
      if (wizardKeyStatus) {
        wizardKeyStatus.hidden = true;
      }
    });
  }

  // Prefill settings (non-blocking)
  try {
    chrome.storage.sync.get(
      ["outputLanguage", "summaryLength"],
      (d) => {
        if (chrome.runtime.lastError) return;
        const lang = document.getElementById("wizardOutputLanguage");
        const len = document.getElementById("wizardSummaryLength");
        if (d.outputLanguage && lang) lang.value = d.outputLanguage;
        if (d.summaryLength && len) len.value = d.summaryLength;
      },
    );
  } catch (_) {}

  goToStep(0);
}

// Run wizard check on popup load (never leave user stranded)
checkWizardStatus().catch((e) => {
  console.warn("[FeedWriter] wizard check failed", e);
  showMainApp();
  maybeOpenKeysTabIfNoKeys().catch(() => {});
});

// === TABS ===
// Cache selectors for better performance
const allTabs = document.querySelectorAll(".tab");
const allTabContents = document.querySelectorAll(".tab-content");

/** Activate a main popup tab by data-tab name (e.g. "apikeys"). */
function activateTab(tabName) {
  const tab = document.querySelector('.tab[data-tab="' + tabName + '"]');
  if (!tab) return;
  allTabs.forEach((t) => {
    t.classList.remove("active");
    t.setAttribute("aria-selected", "false");
    t.setAttribute("tabindex", "-1");
  });
  allTabContents.forEach((c) => {
    c.classList.remove("active");
    c.hidden = true;
  });
  tab.classList.add("active");
  tab.setAttribute("aria-selected", "true");
  tab.setAttribute("tabindex", "0");
  const panel = document.getElementById("tab-" + tab.dataset.tab);
  if (panel) {
    panel.classList.add("active");
    panel.hidden = false;
  }
  if (tab.dataset.tab === "history") {
    loadHistory();
    loadAgentStats();
  }
  if (tab.dataset.tab === "apikeys") loadKeyLists();
}

/**
 * When there are no API keys (and no legacy single key), open the Keys tab
 * so first-run / empty-key users land on setup instead of Settings.
 */
async function maybeOpenKeysTabIfNoKeys() {
  try {
    if (typeof ensureApiKeysLoaded === "function" && typeof _countApiKeys === "function") {
      const { apiKeys } = await ensureApiKeysLoaded();
      if (_countApiKeys(apiKeys) === 0) activateTab("apikeys");
      return;
    }
    const data = await chrome.storage.sync.get(["apiKeys", "apiKey"]);
    const apiKeys = data.apiKeys || {};
    const total = Object.values(apiKeys).reduce(
      (n, arr) => n + (Array.isArray(arr) ? arr.length : 0),
      0,
    );
    const hasLegacy = !!(data.apiKey && String(data.apiKey).trim());
    if (total === 0 && !hasLegacy) activateTab("apikeys");
  } catch (e) {
    console.warn("[FeedWriter] maybeOpenKeysTabIfNoKeys failed", e);
  }
}

// Initial roving tabindex for tabs
allTabs.forEach((t) => {
  t.setAttribute("tabindex", t.classList.contains("active") ? "0" : "-1");
});

allTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    activateTab(tab.dataset.tab);
  });
});

// Arrow-key tab navigation (a11y)
document.querySelector(".tabs")?.addEventListener("keydown", (e) => {
  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
  const tabs = Array.from(allTabs);
  const i = tabs.indexOf(document.activeElement);
  if (i < 0) return;
  e.preventDefault();
  let next = i;
  if (e.key === "ArrowRight") next = (i + 1) % tabs.length;
  if (e.key === "ArrowLeft") next = (i - 1 + tabs.length) % tabs.length;
  if (e.key === "Home") next = 0;
  if (e.key === "End") next = tabs.length - 1;
  tabs[next].focus();
  tabs[next].click();
});

// === SETTINGS ===
const minLengthInput = document.getElementById("minLength");
const outputLangSel = document.getElementById("outputLanguage");
const summaryLengthSel = document.getElementById("summaryLength");
const promptStyleSel = document.getElementById("promptStyle");
const customInstructionsEl = document.getElementById("customInstructions");
const customSummaryPromptEl = document.getElementById("customSummaryPrompt");
const sourceTemplateEl = document.getElementById("sourceTemplate");
const adDisplayModeEl = document.getElementById("adDisplayMode");
const filterEngagementGatesEl = document.getElementById("filterEngagementGates");
const blockedDomainsEl = document.getElementById("blockedDomains");
const enableUnicodeBoldEl = document.getElementById("enableUnicodeBold");
const saveBtn = document.getElementById("saveBtn");
const status = document.getElementById("status");


// Advanced Mode Controls
const advancedModeToggle = document.getElementById("advancedModeToggle");
const tabSettings = document.getElementById("tab-settings");
const settingsModeTitle = document.querySelector(".settings-mode-title");

function updateAdvancedModeView(enabled) {
  if (!tabSettings) return;
  tabSettings.classList.toggle("hide-advanced", !enabled);
  tabSettings.classList.toggle("is-advanced", !!enabled);
}

if (advancedModeToggle) {
  advancedModeToggle.addEventListener("change", async () => {
    const enabled = advancedModeToggle.checked;
    try {
      await chrome.storage.sync.set({ advancedModeEnabled: enabled });
    } catch (_) {}
    updateAdvancedModeView(enabled);
  });
}

chrome.storage.sync.get(
  [
    "minLength",
    "outputLanguage",
    "summaryLength",
    "promptStyle",
    "customInstructions",
    "customSummaryPrompt",
    "sourceTemplate",
    "adDisplayMode",
    "filterEngagementGates",
    "blockedDomains",
    "enableUnicodeBold",
    "apiKeys",
    "advancedModeEnabled",
  ],
  (d) => {
    if (d.minLength) minLengthInput.value = d.minLength;
    if (d.outputLanguage) outputLangSel.value = d.outputLanguage;
    if (d.summaryLength) summaryLengthSel.value = d.summaryLength;
    if (d.promptStyle) promptStyleSel.value = d.promptStyle;
    if (d.customInstructions) customInstructionsEl.value = d.customInstructions;
    if (d.customSummaryPrompt)
      customSummaryPromptEl.value = d.customSummaryPrompt;
    if (d.sourceTemplate) sourceTemplateEl.value = d.sourceTemplate;
    if (d.adDisplayMode) adDisplayModeEl.value = d.adDisplayMode === "mark" ? "mark" : "collapse";
    if (filterEngagementGatesEl) filterEngagementGatesEl.checked = d.filterEngagementGates === true;
    if (d.blockedDomains) blockedDomainsEl.value = d.blockedDomains;
    if (d.enableUnicodeBold !== false) enableUnicodeBoldEl.checked = true;

    // Set advanced mode toggle state
    const advancedEnabled = !!d.advancedModeEnabled;
    if (advancedModeToggle) advancedModeToggle.checked = advancedEnabled;
    updateAdvancedModeView(advancedEnabled);

    const total = Object.values(d.apiKeys || {}).reduce(
      (s, a) => s + (a ? a.length : 0),
      0,
    );
    if (total === 0)
      showStatus('Chưa có API Key. Thêm ở tab "API Keys".', "error");
  },
);

if (saveBtn) saveBtn.addEventListener("click", () => {
  // Input validation
  const minLen = parseInt(minLengthInput?.value, 10);
  if (isNaN(minLen) || minLen < 100 || minLen > 5000) {
    showStatus("Độ dài tối thiểu phải từ 100-5000 ký tự", "error");
    return;
  }

  // Guard against double-submit while the async save + backup round-trip runs.
  if (saveBtn.disabled) return;
  const saveBtnLabel = saveBtn.textContent;
  saveBtn.disabled = true;
  saveBtn.textContent = "Đang lưu...";
  const restoreSaveBtn = () => {
    saveBtn.disabled = false;
    saveBtn.textContent = saveBtnLabel;
  };

  chrome.storage.sync.set(
    {
      minLength: minLen,
      outputLanguage: outputLangSel.value,
      summaryLength: summaryLengthSel.value,
      promptStyle: promptStyleSel.value,
      customInstructions: customInstructionsEl.value.trim(),
      customSummaryPrompt: customSummaryPromptEl.value.trim(),
      sourceTemplate: sourceTemplateEl.value.trim(),
      adDisplayMode: adDisplayModeEl?.value === "mark" ? "mark" : "collapse",
      filterEngagementGates: filterEngagementGatesEl?.checked === true,
      blockedDomains: blockedDomainsEl ? blockedDomainsEl.value.trim() : "",
      enableUnicodeBold: enableUnicodeBoldEl
        ? enableUnicodeBoldEl.checked !== false
        : true,
      advancedModeEnabled: !!(advancedModeToggle && advancedModeToggle.checked),
      languageAutoDetected: false, // User manually changed settings
    },
    () => {
      restoreSaveBtn();
      if (chrome.runtime.lastError) {
        showStatus("Lưu thất bại — thử lại", "error");
        return;
      }
      showStatus("Đã lưu", "success");
      // Create backup after saving
      chrome.runtime.sendMessage({ action: "backupSettings" }, (response) => {
        if (response && response.success) {
          loadBackupList();
        }
      });
    },
  );
});

// Enable test mode debug panel
if (typeof featureFlags !== 'undefined' && featureFlags.testMode) {
  const debugPanel = document.getElementById('debugPanel');
  if (debugPanel) {
    debugPanel.style.display = 'block';
    updateDebugInfo();
  }
}

function updateDebugInfo() {
  const debugInfo = document.getElementById('debugInfo');
  if (!debugInfo) return;

  chrome.storage.local.get(['history', 'telemetry'], (data) => {
    const historyCount = data.history ? data.history.length : 0;
    const telemetry = data.telemetry || {};
    const now = Date.now();
    debugInfo.innerHTML = `
      <div>History items: ${historyCount}</div>
      <div>Sessions: ${telemetry.sessions || 0}</div>
      <div>Summaries: ${telemetry.summaries || 0}</div>
      <div>Errors: ${telemetry.errors || 0}</div>
      <div>Test Mode: Enabled</div>
      <div>Last active: ${new Date(now).toLocaleTimeString()}</div>
    `;
  });
}

function showStatus(msg, type) {
  if (!status) return;
  status.textContent = msg;
  status.className = "status " + (type || "info");
  status.hidden = false;
  status.style.display = "block";
  clearTimeout(showStatus._t);
  showStatus._t = setTimeout(() => {
    status.hidden = true;
    status.style.display = "none";
    status.textContent = "";
    status.className = "status";
  }, 4000);
}

// History tab has its own status element (#status lives in the Settings tab,
// so history actions must not write there — otherwise feedback + the Undo
// button render on the wrong, hidden tab).
const historyStatus = document.getElementById("historyStatus");
let historyStatusTimer = null;
function showHistoryStatus(msg, type, durationMs = 4000) {
  if (!historyStatus) return showStatus(msg, type);
  if (historyStatusTimer) clearTimeout(historyStatusTimer);
  historyStatus.textContent = msg;
  historyStatus.className = "status " + type;
  historyStatus.style.display = "block";
  historyStatusTimer = setTimeout(() => {
    historyStatus.style.display = "none";
  }, durationMs);
  return historyStatus;
}

function esc(s) {
  const d = document.createElement("span");
  d.textContent = s;
  return d.innerHTML;
}

// === API KEYS ===
const newApiKeyInput = document.getElementById("newApiKey");
const addKeyBtn = document.getElementById("addKeyBtn");
const toggleNewApiKey = document.getElementById("toggleNewApiKey");
if (toggleNewApiKey) {
  const eyeOn = toggleNewApiKey.querySelector(".icon-eye");
  const eyeOff = toggleNewApiKey.querySelector(".icon-eye-off");
  toggleNewApiKey.addEventListener("click", () => {
    const show = newApiKeyInput.type === "password";
    newApiKeyInput.type = show ? "text" : "password";
    toggleNewApiKey.setAttribute("aria-pressed", String(show));
    if (eyeOn) eyeOn.hidden = show;
    if (eyeOff) eyeOff.hidden = !show;
    newApiKeyInput.focus();
  });
}
const keyStatus = document.getElementById("keyStatus");
const testBtn = document.getElementById("testBtn");
const keyEmptyState = document.getElementById("keyEmptyState");
function showKeyStatus(msg, type) {
  if (!keyStatus) return;
  keyStatus.textContent = msg;
  keyStatus.className = "status " + (type || "info");
  keyStatus.hidden = false;
  keyStatus.style.display = "block";
  clearTimeout(showKeyStatus._t);
  showKeyStatus._t = setTimeout(() => {
    keyStatus.hidden = true;
    keyStatus.style.display = "none";
    keyStatus.textContent = "";
    keyStatus.className = "status";
  }, 3500);
}

function maskKey(key) {
  if (!key || key.length <= 10) return "••••••••";
  // Show more prefix/suffix so list is readable (was too aggressive → looked “cut”)
  const head = key.length > 24 ? 10 : 8;
  const tail = 5;
  return key.substring(0, head) + "…" + key.substring(key.length - tail);
}

function detectProvider(key) {
  if (key.startsWith("gsk_")) return "groq";
  if (key.startsWith("AI")) return "gemini";
  if (key.startsWith("csk-")) return "cerebras";
  if (key.startsWith("sk-or-")) return "openrouter";
  return "sambanova";
}

const ALL_PROVIDERS = ["groq", "gemini", "cerebras", "sambanova", "openrouter"];

/** Count keys in an apiKeys map. */
function _countApiKeys(apiKeys) {
  if (!apiKeys || typeof apiKeys !== "object") return 0;
  return Object.values(apiKeys).reduce(
    (n, arr) => n + (Array.isArray(arr) ? arr.length : 0),
    0,
  );
}

/**
 * Load apiKeys from sync; if empty, restore from local backupApiKeys
 * (same recovery path as the service worker).
 * Returns { apiKeys, restoredFromBackup }.
 */
async function ensureApiKeysLoaded() {
  const data = await chrome.storage.sync.get(["apiKeys", "apiKey", "provider"]);
  let apiKeys = data.apiKeys || {};
  for (const p of ALL_PROVIDERS) {
    if (!Array.isArray(apiKeys[p])) apiKeys[p] = [];
  }

  // Legacy single-key migration
  if (data.apiKey) {
    const provider = data.provider || detectProvider(data.apiKey);
    if (!apiKeys[provider]) apiKeys[provider] = [];
    if (!apiKeys[provider].includes(data.apiKey)) {
      apiKeys[provider].push(data.apiKey);
      await chrome.storage.sync.set({ apiKeys });
      await chrome.storage.local.set({ backupApiKeys: apiKeys });
    }
  }

  let restoredFromBackup = false;
  if (_countApiKeys(apiKeys) === 0) {
    const local = await chrome.storage.local.get(["backupApiKeys"]);
    const backup = local.backupApiKeys;
    if (backup && _countApiKeys(backup) > 0) {
      apiKeys = backup;
      for (const p of ALL_PROVIDERS) {
        if (!Array.isArray(apiKeys[p])) apiKeys[p] = [];
      }
      try {
        await chrome.storage.sync.set({ apiKeys });
        restoredFromBackup = true;
        console.info(
          "[FeedWriter] Restored",
          _countApiKeys(apiKeys),
          "API key(s) from local backup",
        );
      } catch (e) {
        console.warn("[FeedWriter] Could not write restored keys to sync", e);
      }
    }
  } else {
    // Keep local backup in sync with live keys (cheap insurance)
    try {
      await chrome.storage.local.set({ backupApiKeys: apiKeys });
    } catch (_) {}
  }

  return { apiKeys, restoredFromBackup };
}

function _updateKeysTabBadge(total) {
  const tab = document.getElementById("tabbtn-apikeys");
  if (!tab) return;
  let badge = tab.querySelector(".tab-count");
  if (total > 0) {
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "tab-count";
      tab.appendChild(badge);
    }
    badge.textContent = String(total);
    badge.hidden = false;
  } else if (badge) {
    badge.hidden = true;
  }
}

async function loadKeyLists() {
  const { apiKeys, restoredFromBackup } = await ensureApiKeysLoaded();
  const localData = await chrome.storage.local.get(["keyStatus"]);
  const ks = localData.keyStatus || {};
  let totalKeys = 0;
  for (const p of ALL_PROVIDERS) {
    const keys = apiKeys[p] || [];
    totalKeys += keys.length;
    const cap = p.charAt(0).toUpperCase() + p.slice(1);
    const wrapper = document.getElementById("keyList" + cap);
    if (wrapper) wrapper.style.display = keys.length > 0 ? "block" : "none";
    renderKeyList(p, keys, ks);
  }
  if (keyEmptyState) {
    const empty = totalKeys === 0;
    keyEmptyState.style.display = empty ? "block" : "none";
    keyEmptyState.hidden = !empty;
  }
  _updateKeysTabBadge(totalKeys);
  if (restoredFromBackup && totalKeys > 0) {
    showKeyStatus(
      "Đã khôi phục " + totalKeys + " key từ backup local",
      "success",
    );
  }
}

/** Normalize various import shapes into { provider: string[] }. */
function _normalizeImportedApiKeys(raw) {
  let obj = raw;
  if (raw && raw.apiKeys && typeof raw.apiKeys === "object") obj = raw.apiKeys;
  if (!obj || typeof obj !== "object") return null;
  const out = {};
  for (const p of ALL_PROVIDERS) out[p] = [];
  // Shape A: { groq: ["gsk_…"], … }
  let matched = false;
  for (const p of ALL_PROVIDERS) {
    if (Array.isArray(obj[p])) {
      matched = true;
      for (const k of obj[p]) {
        if (typeof k === "string" && k.trim()) out[p].push(k.trim());
      }
    }
  }
  // Shape B: flat array of key strings
  if (!matched && Array.isArray(obj)) {
    matched = true;
    for (const k of obj) {
      if (typeof k === "string" && k.trim()) {
        const provider = detectProvider(k.trim());
        out[provider].push(k.trim());
      }
    }
  }
  // Shape C: { keys: ["…"] }
  if (!matched && Array.isArray(obj.keys)) {
    matched = true;
    for (const k of obj.keys) {
      if (typeof k === "string" && k.trim()) {
        out[detectProvider(k.trim())].push(k.trim());
      }
    }
  }
  if (!matched) return null;
  // de-dupe
  for (const p of ALL_PROVIDERS) {
    out[p] = [...new Set(out[p])];
  }
  return out;
}

async function mergeAndSaveApiKeys(incoming, { replace = false } = {}) {
  const data = await chrome.storage.sync.get(["apiKeys"]);
  const base = replace ? {} : data.apiKeys || {};
  const apiKeys = {};
  for (const p of ALL_PROVIDERS) {
    const a = Array.isArray(base[p]) ? base[p].slice() : [];
    const b = Array.isArray(incoming[p]) ? incoming[p] : [];
    apiKeys[p] = [...new Set([...a, ...b])];
  }
  await chrome.storage.sync.set({ apiKeys });
  await chrome.storage.local.set({
    backupApiKeys: apiKeys,
    backupApiKeysAt: Date.now(),
  });
  return _countApiKeys(apiKeys);
}

async function exportApiKeys() {
  const { apiKeys } = await ensureApiKeysLoaded();
  const total = _countApiKeys(apiKeys);
  if (total === 0) {
    showKeyStatus("Chưa có key để export", "error");
    return;
  }
  const payload = {
    version: 1,
    type: "feedwriter-api-keys",
    exportedAt: new Date().toISOString(),
    apiKeys,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download =
    "feedwriter-keys-" + new Date().toISOString().slice(0, 10) + ".json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  showKeyStatus("Đã export " + total + " key", "success");
}

async function importApiKeysFromFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const raw = JSON.parse(text);
    const incoming = _normalizeImportedApiKeys(raw);
    if (!incoming || _countApiKeys(incoming) === 0) {
      showKeyStatus("File JSON không có API key hợp lệ", "error");
      return;
    }
    const total = await mergeAndSaveApiKeys(incoming, { replace: false });
    await loadKeyLists();
    showKeyStatus(
      "Đã import · tổng " + total + " key (merge, không ghi đè trùng)",
      "success",
    );
  } catch (e) {
    showKeyStatus("Import lỗi: " + (e.message || e), "error");
  }
}

function renderKeyList(provider, keys, keyStatusData) {
  const cap = provider.charAt(0).toUpperCase() + provider.slice(1);
  const container = document.getElementById("keyList" + cap + "Items");
  if (!container || keys.length === 0) {
    if (container) container.innerHTML = "";
    return;
  }

  container.innerHTML = keys
    .map((key, i) => {
      const info = keyStatusData[key] || {};
      let cls, txt;
      if (info.rateLimitedUntil && Date.now() < info.rateLimitedUntil) {
        cls = "is-limited";
        txt =
          "Limit " +
          Math.ceil((info.rateLimitedUntil - Date.now()) / 60000) +
          "p";
      } else if (info.lastUsed && Date.now() - info.lastUsed < 60000) {
        cls = "is-active";
        txt = "Vừa dùng";
      } else {
        cls = "is-ok";
        txt = "OK";
      }
      return (
        '<div class="key-item">' +
          '<code class="key-item-text" title="' + esc(maskKey(key)) + '">' +
            esc(maskKey(key)) +
          "</code>" +
          '<span class="key-item-status ' + cls + '">' + esc(txt) + "</span>" +
          '<button type="button" class="key-item-delete" data-provider="' +
            provider +
            '" data-idx="' +
            i +
            '" title="Xóa key" aria-label="Xóa key">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
          "</button>" +
        "</div>"
      );
    })
    .join("");
}

// Event delegation for key delete buttons (click may land on SVG child)
document.addEventListener("click", async (e) => {
  const btn = e.target.closest(".key-item-delete");
  if (!btn) return;
  const d = await chrome.storage.sync.get(["apiKeys"]);
  const apiKeys = d.apiKeys || {};
  if (apiKeys[btn.dataset.provider])
    apiKeys[btn.dataset.provider].splice(+btn.dataset.idx, 1);
  await chrome.storage.sync.set({ apiKeys });
  await chrome.storage.local.set({ backupApiKeys: apiKeys });
  loadKeyLists();
  showKeyStatus("Đã xóa", "success");
});


// Single in-flight guard shared by the button + paste auto-add, so a fast
// double paste / click can't push the same key twice or race the storage write.
let isAddingKey = false;

// Returns true only when a new key was actually persisted.
async function addApiKey() {
  if (isAddingKey) return false;
  const key = newApiKeyInput.value.trim();
  if (!key) {
    showKeyStatus("Nhập API Key", "error");
    return false;
  }
  isAddingKey = true;
  addKeyBtn.disabled = true;
  try {
    const provider = detectProvider(key);
    const data = await chrome.storage.sync.get(["apiKeys"]);
    const apiKeys = data.apiKeys || {};
    for (const p of ALL_PROVIDERS) {
      if (!apiKeys[p]) apiKeys[p] = [];
    }
    if (apiKeys[provider].includes(key)) {
      showKeyStatus("Key đã tồn tại", "error");
      return false;
    }
    apiKeys[provider].push(key);
    await chrome.storage.sync.set({ apiKeys });
    await chrome.storage.local.set({ backupApiKeys: apiKeys });
    newApiKeyInput.value = "";
    loadKeyLists();
    showKeyStatus(
      "Đã thêm — " + provider.charAt(0).toUpperCase() + provider.slice(1),
      "success",
    );
    return true;
  } finally {
    isAddingKey = false;
    addKeyBtn.disabled = false;
  }
}

// Auto-validate API key on paste — add, then test only if the add succeeded.
// Awaits the add (no fixed-delay guess) so the test reads committed storage.
newApiKeyInput.addEventListener('paste', () => {
  setTimeout(async () => {
    const key = newApiKeyInput.value.trim();
    // Paste recovery JSON into the key field → import
    if (key.startsWith("{") && key.includes("apiKeys")) {
      try {
        const raw = JSON.parse(key);
        const incoming = _normalizeImportedApiKeys(raw);
        if (incoming && _countApiKeys(incoming) > 0) {
          const total = await mergeAndSaveApiKeys(incoming);
          newApiKeyInput.value = "";
          await loadKeyLists();
          showKeyStatus("Đã import " + total + " key từ clipboard JSON", "success");
          return;
        }
      } catch (_) {}
    }
    if (key.length > 20) {
      const added = await addApiKey();
      if (added) await handleTestConnection(testBtn);
    }
  }, 10);
});

addKeyBtn.addEventListener("click", () => addApiKey());

// Export / Import keys (survives reinstall if you keep the JSON file)
const exportKeysBtn = document.getElementById("exportKeysBtn");
const importKeysBtn = document.getElementById("importKeysBtn");
const importKeysFile = document.getElementById("importKeysFile");
const emptyImportBtn = document.getElementById("emptyImportBtn");
if (exportKeysBtn) exportKeysBtn.addEventListener("click", () => exportApiKeys());
function triggerImportPicker() {
  if (importKeysFile) importKeysFile.click();
}
if (importKeysBtn) importKeysBtn.addEventListener("click", triggerImportPicker);
if (emptyImportBtn) emptyImportBtn.addEventListener("click", triggerImportPicker);
if (importKeysFile) {
  importKeysFile.addEventListener("change", async () => {
    const file = importKeysFile.files && importKeysFile.files[0];
    await importApiKeysFromFile(file);
    importKeysFile.value = "";
  });
}

async function handleTestConnection(btn) {
  const data = await chrome.storage.sync.get(["apiKeys"]);
  const total = Object.values(data.apiKeys || {}).reduce(
    (s, a) => s + (a ? a.length : 0),
    0,
  );
  if (total === 0) {
    showKeyStatus("Chưa có API Key. Thêm key ở ô bên trên.", "error");
    return;
  }
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = "Đang test...";
  try {
    const r = await chrome.runtime.sendMessage({ action: "test-connection" });
    if (r?.ok) {
      showKeyStatus("" + r.provider + (r.model ? " — " + r.model : " — OK"), "success");
    } else if (r?.error && r.error.includes("429")) {
      showKeyStatus("Rate limited — thử lại sau vài phút", "error");
    } else if (r?.error && (r.error.includes("401") || r.error.includes("403"))) {
      showKeyStatus("Key không hợp lệ hoặc hết hạn", "error");
    } else if (r?.error && r.error.includes("network")) {
      showKeyStatus("Lỗi mạng — kiểm tra kết nối internet", "error");
    } else {
      showKeyStatus(r?.error || "Lỗi không xác định", "error");
    }
  } catch (e) {
    if (e.message.includes("Extension context invalidated")) {
      showKeyStatus("Extension đã reload — mở lại popup", "error");
    } else {
      showKeyStatus("Lỗi: " + e.message, "error");
    }
  }
  btn.disabled = false;
  btn.textContent = originalText;
}

testBtn.addEventListener("click", () => handleTestConnection(testBtn));

const debugTestBtn = document.getElementById("debugTestBtn");
if (debugTestBtn) {
  debugTestBtn.addEventListener("click", () => handleTestConnection(debugTestBtn));
}

// Clear cache button (test mode)
const clearCacheBtn = document.getElementById("clearCacheBtn");
if (clearCacheBtn) {
  clearCacheBtn.addEventListener("click", async () => {
    try {
      // Clear local storage cache
      await chrome.storage.local.remove(['history', 'telemetry']);
      // Send message to content script to clear summaryCache
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: "clear-cache" });
      }
      showStatus("Đã xóa cache", "success");
      // Reload history
      loadHistory();
    } catch (e) {
      showStatus("Lỗi xóa cache: " + e.message, "error");
    }
  });
}

// Load keys (+ restore from local backup if sync was wiped)
loadKeyLists();

// === HISTORY ===
let historyData = [];

function formatHm(ts) {
  return new Date(ts).toLocaleTimeString("vi", { hour: "2-digit", minute: "2-digit" });
}

function renderPostTimeSuggestions(items) {
  const box = document.getElementById("postTimeSuggestBox");
  if (!box) return;
  if (!items || items.length < 1) {
    box.style.display = "none";
    box.innerHTML = "";
    return;
  }

  const sorted = [...items].sort((a, b) => new Date(a.date) - new Date(b.date));
  const firstTs = new Date(sorted[0].date).getTime();
  if (!Number.isFinite(firstTs)) {
    box.style.display = "none";
    box.innerHTML = "";
    return;
  }

  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  const candidates = [];
  for (let i = 1; i <= 24; i++) {
    const t1 = firstTs + i * oneHour;
    const t2 = firstTs + i * 2 * oneHour;
    if (t1 > now) candidates.push(t1);
    if (t2 > now) candidates.push(t2);
  }

  const unique = [...new Set(candidates)]
    .sort((a, b) => a - b)
    .slice(0, 4);

  if (unique.length === 0) {
    box.style.display = "none";
    box.innerHTML = "";
    return;
  }

  box.style.display = "block";
  box.innerHTML = `
    <div class="post-time-suggest-title">Gợi ý giờ đăng tiếp theo (cách 1–2 giờ từ bài đầu)</div>
    <div class="post-time-suggest-list">
      ${unique.map((ts) => `<span class="post-time-pill">${formatHm(ts)}</span>`).join("")}
    </div>
  `;
}

/** Collapse whitespace + repeated tokens so list previews stay readable. */
function cleanHistoryPreview(raw, maxLen) {
  if (!raw) return "";
  let t = String(raw)
    .replace(/[\u200b-\u200f\u202a-\u202e\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  // "FacebookFacebookFacebook" (no spaces)
  t = t.replace(/\b([A-Za-zÀ-ỹ]{3,})\1{1,}\b/gi, "$1");
  // "Facebook Facebook Facebook"
  t = t.replace(/\b([A-Za-zÀ-ỹ]{2,})(?:\s+\1){2,}\b/gi, "$1");
  // Drop pure chrome noise
  if (/^(facebook|threads|linkedin|reddit|twitter|x)(\s+\1)*$/i.test(t)) return "";
  if (t.length > maxLen) t = t.slice(0, maxLen).replace(/\s+\S*$/, "").trim() + "…";
  return t;
}

function formatSiteLabel(site) {
  const s = String(site || "").toLowerCase();
  const map = {
    facebook: "Facebook",
    threads: "Threads",
    x: "X",
    twitter: "X",
    linkedin: "LinkedIn",
    reddit: "Reddit",
  };
  return map[s] || (site ? String(site) : "");
}

function typeBadgeLabel(type) {
  if (type === "status_share") return "Status";
  if (type === "comment_summary") return "Bình luận";
  if (type === "translate" || String(type || "").startsWith("translate")) return "Dịch";
  return "Tóm tắt";
}

async function loadHistory() {
  const data = await chrome.storage.local.get("history");
  historyData = data.history || [];
  const list = document.getElementById("historyList");
  const detail = document.getElementById("historyDetail");
  const actions = document.getElementById("historyActions");
  detail.style.display = "none";
  list.style.display = "block";
  actions.style.display = historyData.length > 0 ? "block" : "none";
  renderPostTimeSuggestions(historyData);
  if (historyData.length === 0) {
    list.innerHTML = '<p class="empty">Chưa có lịch sử</p>';
    return;
  }
  list.innerHTML = historyData
    .map((h, i) => {
      const bt = h.type || "summary";
      const dateStr = esc(new Date(h.date).toLocaleString("vi"));
      const siteStr = esc(formatSiteLabel(h.site));
      const badge = esc(typeBadgeLabel(bt));
      // Prefer AI summary as title; original text only if useful
      // Longer previews — CSS line-clamp handles final fit (was 100/90, looked cut off)
      const title = cleanHistoryPreview(h.summary || "", 220) || cleanHistoryPreview(h.text || "", 220) || "Không có nội dung";
      let excerpt = cleanHistoryPreview(h.text || "", 160);
      // Avoid duplicating the same line under the title
      if (excerpt && title.startsWith(excerpt.slice(0, 40))) excerpt = "";
      if (excerpt && excerpt === title) excerpt = "";

      return (
        '<article class="history-item" data-idx="' + i + '" role="button" tabindex="0">' +
          '<div class="history-meta">' +
            '<time class="history-date">' + dateStr + "</time>" +
            (siteStr ? '<span class="history-site">' + siteStr + "</span>" : "") +
            '<span class="history-badge history-badge--' + esc(bt) + '">' + badge + "</span>" +
          "</div>" +
          '<div class="history-title">' + esc(title) + "</div>" +
          (excerpt ? '<div class="history-excerpt">' + esc(excerpt) + "</div>" : "") +
        "</article>"
      );
    })
    .join("");
  if (typeof featureFlags !== "undefined" && featureFlags.testMode) {
    updateDebugInfo();
  }
}

// Event delegation for history items
document.addEventListener("click", (e) => {
  const item = e.target.closest(".history-item");
  if (item) showHistoryDetail(+item.dataset.idx);
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const item = e.target.closest(".history-item");
  if (!item || e.target !== item) return;
  e.preventDefault();
  showHistoryDetail(+item.dataset.idx);
});

function showHistoryDetail(idx) {
  const h = historyData[idx];
  if (!h) return;
  document.getElementById("historyList").style.display = "none";
  document.getElementById("historyActions").style.display = "none";
  document.getElementById("historyDetail").style.display = "block";
  const siteLabel = formatSiteLabel(h.site);
  document.getElementById("historyDetailDate").textContent =
    new Date(h.date).toLocaleString("vi") +
    (siteLabel ? " · " + siteLabel : "") +
    " · " +
    typeBadgeLabel(h.type || "summary");
  document.getElementById("historyDetailBody").textContent = h.summary || "";
}

document.getElementById("historyBack").addEventListener("click", () => {
  document.getElementById("historyDetail").style.display = "none";
  document.getElementById("historyList").style.display = "block";
  document.getElementById("historyActions").style.display = "block";
});

document.getElementById("historyDetailCopy").addEventListener("click", () => {
  navigator.clipboard
    .writeText(document.getElementById("historyDetailBody").textContent)
    .then(() => {
      const btn = document.getElementById("historyDetailCopy");
      btn.textContent = "Copied";
      setTimeout(() => {
        btn.textContent = "Copy";
      }, 1500);
    });
});

document.getElementById("exportBtn").addEventListener("click", async () => {
  const data = await chrome.storage.local.get("history");
  const blob = new Blob([JSON.stringify(data.history || [], null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "feedwriter-history.json";
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("exportMdBtn").addEventListener("click", async () => {
  const data = await chrome.storage.local.get("history");
  const hist = data.history || [];
  let md = "# Lịch sử FeedWriter\n\n";
  hist.forEach((h) => {
    md += `## ${new Date(h.date).toLocaleString("vi")} - ${h.site || ""}\n\n`;
    md += `> ${(h.text || "").replace(/\n/g, "\n> ").substring(0, 500)}...\n\n${h.summary}\n\n---\n\n`;
  });
  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "feedwriter-history.md";
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("rescanBtn").addEventListener("click", async () => {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs[0]?.id) {
      showHistoryStatus("Không tìm thấy tab hiện tại", "error");
      return;
    }
    const res = await chrome.tabs.sendMessage(tabs[0].id, { action: "rescan-feed" });
    if (res?.ok) showHistoryStatus("Đã yêu cầu quét lại feed", "success");
    else showHistoryStatus(res?.error || "Không thể quét lại feed", "error");
  } catch (err) {
    showHistoryStatus("Lỗi quét lại: " + (err?.message || err), "error");
  }
});

document.getElementById("clearBtn").addEventListener("click", async () => {
  if (!confirm("Xóa toàn bộ lịch sử? (Có thể khôi phục trong 30 giây)")) return;

  // Soft delete: backup trước khi xóa
  const data = await chrome.storage.local.get("history");
  const backup = data.history || [];

  await chrome.storage.local.set({ history: [], historyBackup: { items: backup, deletedAt: Date.now() } });
  loadHistory();

  // Show undo option in the History tab's own status bar (not the Settings
  // tab's #status, which would be hidden while the user is on History).
  const statusEl = showHistoryStatus("Đã xóa lịch sử", "success", 30000);
  const undoBtn = document.createElement("button");
  undoBtn.type = "button";
  undoBtn.textContent = "Hoàn tác";
  undoBtn.style.cssText = "margin-left:8px;padding:3px 10px;border:1px solid #3F3F46;border-radius:6px;background:transparent;color:#3F3F46;font-size:12px;cursor:pointer;";
  undoBtn.addEventListener("click", async () => {
    const backupData = await chrome.storage.local.get("historyBackup");
    if (backupData.historyBackup && backupData.historyBackup.items) {
      await chrome.storage.local.set({ history: backupData.historyBackup.items });
      await chrome.storage.local.remove("historyBackup");
      loadHistory();
      showHistoryStatus("Đã khôi phục lịch sử", "success");
    } else {
      showHistoryStatus("Hết thời gian khôi phục — lịch sử đã xóa vĩnh viễn", "error");
    }
  });
  if (statusEl) statusEl.appendChild(undoBtn);

  // Auto-remove backup after 30 seconds
  setTimeout(async () => {
    await chrome.storage.local.remove("historyBackup");
  }, 30000);
});

// === REVIEW TAB ===

/** Human labels for telemetry reason keys (must match content.js map). */
const REASON_LABELS = {
  ads_about_link: "Link QC",
  why_am_i_seeing: "Ad disclosure",
  portal_label: "Nhãn Được tài trợ",
  aria_label: "aria Sponsored",
  sponsored_keyword: "Sponsored / Được tài trợ",
  ad_structure: "Cấu trúc ad",
  ads_library_link: "Ads Library",
  // Bài “làm X để nhận Y” (engagement bait)
  comment_gate: "Comment để nhận link/file",
  like_gate: "Like/react để nhận",
  share_gate: "Share để nhận",
  follow_gate: "Follow để nhận",
  tag_gate: "Tag bạn để nhận",
  join_gate: "Join group để nhận",
  inbox_gate: "Inbox/DM để nhận",
  engagement_combo: "Like+Cmt+Share để nhận",
  engagement_gate: "Làm X để nhận Y",
  action_comment: "yêu cầu comment",
  action_like: "yêu cầu like",
  action_share: "yêu cầu share",
  action_follow: "yêu cầu follow",
  action_tag: "yêu cầu tag",
  action_join: "yêu cầu join",
  action_save: "yêu cầu save",
};

function reasonLabel(key) {
  if (!key) return "–";
  if (REASON_LABELS[key]) return REASON_LABELS[key];
  // Fallback: snake_case → words
  return String(key).replace(/_/g, " ");
}

// === AGENT STATS (Feature 7) ===
async function loadAgentStats() {
  try {
    const data = await chrome.storage.local.get(["agentStats", "agentPostedUrls", "fbsTelemetry"]);
    const stats = data.agentStats;
    const telemetry = data.fbsTelemetry || {};
    const box = document.getElementById("agentStatsBox");
    const hasAgentStats = !!stats || (data.agentPostedUrls && data.agentPostedUrls.length > 0);
    const hasTelemetry = (telemetry.postsScanned || 0) > 0;

    if (!hasAgentStats && !hasTelemetry) {
      box.style.display = "none";
      return;
    }

    // Always show the widget when there are stats
    box.style.display = "block";
    const today = new Date().toDateString();
    const postsToday = (stats && stats.postsTodayDate === today) ? (stats.postsToday || 0) : 0;
    const postsTotal = stats ? (stats.postsTotal || 0) : (data.agentPostedUrls ? data.agentPostedUrls.length : 0);
    const skippedToday = (stats && stats.postsTodayDate === today) ? (stats.skippedToday || 0) : 0;
    const flagged =
      (telemetry.postsFlaggedAds || 0) +
      (telemetry.postsFlaggedCommentGate || 0);

    document.getElementById("statPostsToday").textContent = hasAgentStats ? postsToday : (telemetry.postsScanned || 0);
    document.getElementById("statPostsTotal").textContent = hasAgentStats ? postsTotal : flagged;
    document.getElementById("statSkipped").textContent = hasAgentStats ? skippedToday : (telemetry.falsePositiveProxy || 0);

    if (hasAgentStats) {
      const lastPost = stats && stats.lastPostTime ? new Date(stats.lastPostTime).toLocaleString("vi") : "–";
      const lastEl = document.getElementById("statLastPost");
      lastEl.textContent = lastPost;
      lastEl.title = lastPost;
    } else {
      // Prefer meaningful gate/ad reasons over noisy action_* chips
      const topReasons = telemetry.topReasons || {};
      const ranked = Object.entries(topReasons)
        .filter(([k]) => !String(k).startsWith("action_"))
        .sort((a, b) => b[1] - a[1]);
      const topReason = ranked[0];
      const reasonEl = document.getElementById("statLastPost");
      if (topReason) {
        const label = reasonLabel(topReason[0]);
        const reasonText = `${label} (${topReason[1]})`;
        reasonEl.textContent = reasonText;
        reasonEl.title =
          `${label}\nMã nội bộ: ${topReason[0]}\nSố lần bắt hôm nay: ${topReason[1]}` +
          (topReason[0] === "comment_gate" || String(topReason[0]).endsWith("_gate")
            ? "\n→ Bài kiểu “comment/like/share để nhận link, file…”"
            : "");
      } else {
        reasonEl.textContent = "–";
        reasonEl.title = "";
      }
    }
  } catch (err) {
    console.warn("[FeedWriter] Failed to load stats:", err?.message || err);
  }
}

// === ABOUT: load version from manifest ===
const ver = chrome.runtime.getManifest().version;
const verEl = document.getElementById("aboutVersion");
if (verEl) verEl.textContent = "FeedWriter v" + ver;

const isMacPlatform = /Mac|iPhone|iPad|iPod/i.test(
  navigator.platform || navigator.userAgent || "",
);
document.querySelectorAll("[data-shortcut-key]").forEach((el) => {
  const key = el.getAttribute("data-shortcut-key") || "";
  el.textContent = isMacPlatform ? "⌘⇧" + key : "Ctrl+Shift+" + key;
});
const wizardShortcutHint = document.getElementById("wizardShortcutHint");
if (wizardShortcutHint) {
  const prefix = isMacPlatform ? "⌘⇧" : "Ctrl+Shift+";
  wizardShortcutHint.textContent =
    "Phím tắt: " + prefix + "S (Tóm tắt), " + prefix + "T (Dịch EN→VI)";
}

// === ACCORDION LOGIC ===
function toggleAccordion(header) {
  header.classList.toggle('active');
  const isActive = header.classList.contains('active');
  header.setAttribute('aria-expanded', String(isActive));

  const content = header.nextElementSibling;
  content.style.display = isActive ? 'block' : 'none';
}

document.querySelectorAll('.accordion-header').forEach(header => {
  header.addEventListener('click', () => toggleAccordion(header));
  if (header.tagName === 'BUTTON') return;
  header.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleAccordion(header);
    }
  });
});

// === TEMPLATE LIBRARY ===
const templateNameInput = document.getElementById("templateName");
const templateTypeSelect = document.getElementById("templateType");
const templatePromptInput = document.getElementById("templatePrompt");
const saveTemplateBtn = document.getElementById("saveTemplateBtn");
const clearTemplateFormBtn = document.getElementById("clearTemplateFormBtn");
const templateStatus = document.getElementById("templateStatus");
const templateList = document.getElementById("templateList");

// Load templates on init
loadTemplates();

// Save template
saveTemplateBtn.addEventListener("click", async () => {
  const name = templateNameInput.value.trim();
  const type = templateTypeSelect.value;
  const prompt = templatePromptInput.value.trim();

  if (!name) {
    showTemplateStatus("Vui lòng nhập tên template", "error");
    return;
  }

  if (!prompt) {
    showTemplateStatus("Vui lòng nhập nội dung prompt", "error");
    return;
  }

  const template = {
    id: Date.now().toString(),
    name,
    type,
    prompt,
    createdAt: Date.now()
  };

  const { templates = [] } = await chrome.storage.local.get("templates");
  templates.push(template);
  await chrome.storage.local.set({ templates });

  showTemplateStatus("Đã lưu template", "success");
  clearTemplateForm();
  loadTemplates();
});

// Clear template form
clearTemplateFormBtn.addEventListener("click", () => {
  clearTemplateForm();
});

function clearTemplateForm() {
  templateNameInput.value = "";
  templatePromptInput.value = "";
  templateTypeSelect.value = "summary";
}

// Load templates
async function loadTemplates() {
  const { templates = [] } = await chrome.storage.local.get("templates");

  if (templates.length === 0) {
    templateList.innerHTML = '<div class="template-empty">Chưa có template nào. Tạo template đầu tiên của bạn!</div>';
    return;
  }

  templateList.innerHTML = templates.map(template => {
    const id = escapeHtml(template.id || "");
    const type = normalizeTemplateType(template.type);
    return `
    <div class="template-item" data-id="${id}">
      <div class="template-header">
        <div class="template-name">${escapeHtml(template.name)}</div>
        <div class="template-type ${type}">${type}</div>
      </div>
      <div class="template-prompt">${escapeHtml(template.prompt)}</div>
      <div class="template-actions">
        <button class="btn btn-secondary template-use-btn" data-id="${id}">Sử dụng</button>
        <button class="btn btn-danger template-delete-btn" data-id="${id}">Xóa</button>
      </div>
    </div>
  `;
  }).join('');

  // Add event listeners
  document.querySelectorAll('.template-use-btn').forEach(btn => {
    btn.addEventListener('click', () => useTemplate(btn.dataset.id));
  });

  document.querySelectorAll('.template-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteTemplate(btn.dataset.id));
  });
}

// Use template
async function useTemplate(id) {
  const { templates = [] } = await chrome.storage.local.get("templates");
  const template = templates.find(t => t.id === id);

  if (!template) return;

  // Apply template to summary prompt field (affiliate writing removed)
  customSummaryPromptEl.value = template.prompt;

  showTemplateStatus("Đã áp dụng template", "success");

  customSummaryPromptEl.scrollIntoView({ behavior: "smooth", block: "center" });
  customSummaryPromptEl.focus();
}

// Delete template
async function deleteTemplate(id) {
  if (!confirm("Xóa template này?")) return;

  const { templates = [] } = await chrome.storage.local.get("templates");
  const filtered = templates.filter(t => t.id !== id);
  await chrome.storage.local.set({ templates: filtered });

  showTemplateStatus("Đã xóa template", "success");
  loadTemplates();
}

// Show template status
function showTemplateStatus(message, type) {
  templateStatus.textContent = message;
  templateStatus.className = `status ${type}`;
  templateStatus.style.display = "block";
  setTimeout(() => {
    templateStatus.style.display = "none";
  }, 3000);
}

// Escape HTML helper
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = String(text || "");
  return div.innerHTML;
}

function normalizeTemplateType(type) {
  return ["summary", "status"].includes(type) ? type : "summary";
}

// === SETTINGS MANAGEMENT ===
const backupSettingsBtn = document.getElementById("backupSettingsBtn");
const restoreSettingsBtn = document.getElementById("restoreSettingsBtn");
const backupList = document.getElementById("backupList");
const settingsManagementStatus = document.getElementById("settingsManagementStatus");

// Load backup list on init
loadBackupList();

// Backup settings
backupSettingsBtn.addEventListener("click", async () => {
  try {
    const response = await chrome.runtime.sendMessage({ action: "backupSettings" });
    if (response && response.success) {
      showSettingsManagementStatus("Đã backup cài đặt", "success");
      loadBackupList();
    } else {
      showSettingsManagementStatus("Lỗi backup: " + (response?.error || "Unknown error"), "error");
    }
  } catch (error) {
    showSettingsManagementStatus("Lỗi backup: " + error.message, "error");
  }
});

// Restore settings (restore most recent)
restoreSettingsBtn.addEventListener("click", async () => {
  if (!confirm("Restore cài đặt từ backup gần nhất?")) return;

  try {
    const response = await chrome.runtime.sendMessage({ action: "restoreSettings", backupIndex: 0 });
    if (response && response.success) {
      showSettingsManagementStatus("Đã restore cài đặt. Reload trang để áp dụng.", "success");
      setTimeout(() => {
        location.reload();
      }, 1500);
    } else {
      showSettingsManagementStatus("Lỗi restore: " + (response?.error || "Unknown error"), "error");
    }
  } catch (error) {
    showSettingsManagementStatus("Lỗi restore: " + error.message, "error");
  }
});

// Load backup list
async function loadBackupList() {
  try {
    const data = await chrome.storage.local.get("settingsBackups");
    const backups = data.settingsBackups || [];

    if (backups.length === 0) {
      backupList.innerHTML = '<div style="text-align:center;padding:12px;color:var(--text-muted);font-size:11px;">Chưa có backup nào</div>';
      return;
    }

    // Show backups in reverse order (most recent first)
    backupList.innerHTML = backups.reverse().map((backup, index) => {
      const date = new Date(backup.timestamp);
      const dateStr = date.toLocaleString('vi-VN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });

      return `
        <div class="backup-item">
          <div class="backup-info">
            <div class="backup-date">${dateStr}</div>
            <div class="backup-version">Version ${backup.version}</div>
          </div>
          <div class="backup-actions">
            <button class="btn btn-secondary backup-restore-btn" data-index="${index}">Restore</button>
          </div>
        </div>
      `;
    }).join('');

    // Add event listeners
    document.querySelectorAll('.backup-restore-btn').forEach(btn => {
      btn.addEventListener('click', () => restoreFromBackup(parseInt(btn.dataset.index)));
    });
  } catch (error) {
    console.error("Failed to load backup list:", error);
  }
}

// Restore from specific backup
async function restoreFromBackup(index) {
  if (!confirm("Restore cài đặt từ backup này?")) return;

  try {
    const response = await chrome.runtime.sendMessage({ action: "restoreSettings", backupIndex: index });
    if (response && response.success) {
      showSettingsManagementStatus("Đã restore cài đặt. Reload trang để áp dụng.", "success");
      setTimeout(() => {
        location.reload();
      }, 1500);
    } else {
      showSettingsManagementStatus("Lỗi restore: " + (response?.error || "Unknown error"), "error");
    }
  } catch (error) {
    showSettingsManagementStatus("Lỗi restore: " + error.message, "error");
  }
}

// Show settings management status
function showSettingsManagementStatus(message, type) {
  settingsManagementStatus.textContent = message;
  settingsManagementStatus.className = `status ${type}`;
  settingsManagementStatus.style.display = "block";
  setTimeout(() => {
    settingsManagementStatus.style.display = "none";
  }, 3000);
}
