// === TABS ===
document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById("tab-" + tab.dataset.tab).classList.add("active");
    if (tab.dataset.tab === "history") loadHistory();
  });
});

// === SETTINGS ===
const providerSel = document.getElementById("provider");
const apiKeyInput = document.getElementById("apiKey");
const minLengthInput = document.getElementById("minLength");
const outputLangSel = document.getElementById("outputLang");
const customPromptEl = document.getElementById("customPrompt");
const toggleKeyBtn = document.getElementById("toggleKey");
const saveBtn = document.getElementById("saveBtn");
const testBtn = document.getElementById("testBtn");
const status = document.getElementById("status");
const linkGroq = document.getElementById("linkGroq");
const linkGemini = document.getElementById("linkGemini");

const KEYS = ["apiKey","minLength","provider","outputLang","customPrompt"];

chrome.storage.sync.get(KEYS, (d) => {
  if (d.apiKey) apiKeyInput.value = d.apiKey;
  if (d.minLength) minLengthInput.value = d.minLength;
  if (d.provider) providerSel.value = d.provider;
  if (d.outputLang) outputLangSel.value = d.outputLang;
  if (d.customPrompt) customPromptEl.value = d.customPrompt;
  updateLinks();
});

providerSel.addEventListener("change", updateLinks);
toggleKeyBtn.addEventListener("click", () => {
  apiKeyInput.type = apiKeyInput.type === "password" ? "text" : "password";
});

function updateLinks() {
  const g = providerSel.value === "groq";
  linkGroq.style.display = g ? "block" : "none";
  linkGemini.style.display = g ? "none" : "block";
  apiKeyInput.placeholder = g ? "gsk_..." : "AI...";
}

saveBtn.addEventListener("click", () => {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) { showStatus("Nhập API Key", "error"); return; }
  chrome.storage.sync.set({
    apiKey,
    minLength: parseInt(minLengthInput.value) || 400,
    provider: providerSel.value,
    outputLang: outputLangSel.value,
    customPrompt: customPromptEl.value.trim(),
  }, () => showStatus("Đã lưu", "success"));
});

testBtn.addEventListener("click", async () => {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) { showStatus("Nhập API Key trước", "error"); return; }
  // Save first so background can use it
  await chrome.storage.sync.set({ apiKey, provider: providerSel.value });
  showStatus("Đang test...", "success");
  try {
    const r = await chrome.runtime.sendMessage({ action: "summarize", text: "Test. Reply: OK" });
    showStatus(r?.summary ? "Kết nối OK" : (r?.error || "Lỗi"), r?.summary ? "success" : "error");
  } catch (e) { showStatus("Lỗi: " + e.message, "error"); }
});

function showStatus(msg, type) {
  status.textContent = msg;
  status.className = "status " + type;
  status.style.display = "block";
  setTimeout(() => { status.style.display = "none"; }, 3000);
}

// === HISTORY ===
async function loadHistory() {
  const data = await chrome.storage.local.get("history");
  const list = document.getElementById("historyList");
  const history = data.history || [];
  if (history.length === 0) { list.innerHTML = '<p class="empty">Chưa có lịch sử</p>'; return; }
  list.innerHTML = history.map((h, i) =>
    '<div class="history-item">' +
    '<div class="history-date">' + new Date(h.date).toLocaleString("vi") + '</div>' +
    '<div class="history-text">' + (h.text || "").substring(0, 80) + '...</div>' +
    '<div class="history-summary">' + (h.summary || "").substring(0, 120) + '...</div>' +
    '</div>'
  ).join("");
}

document.getElementById("exportBtn").addEventListener("click", async () => {
  const data = await chrome.storage.local.get("history");
  const blob = new Blob([JSON.stringify(data.history || [], null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "summarizer-history.json"; a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("clearBtn").addEventListener("click", async () => {
  await chrome.storage.local.remove("history");
  loadHistory();
  showStatus("Đã xóa", "success");
});
