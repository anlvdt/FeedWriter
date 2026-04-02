const providerSel = document.getElementById("provider");
const apiKeyInput = document.getElementById("apiKey");
const minLengthInput = document.getElementById("minLength");
const toggleKeyBtn = document.getElementById("toggleKey");
const saveBtn = document.getElementById("saveBtn");
const testBtn = document.getElementById("testBtn");
const status = document.getElementById("status");
const linkGroq = document.getElementById("linkGroq");
const linkGemini = document.getElementById("linkGemini");

chrome.storage.sync.get(["apiKey", "minLength", "provider"], (data) => {
  if (data.apiKey) apiKeyInput.value = data.apiKey;
  if (data.minLength) minLengthInput.value = data.minLength;
  if (data.provider) providerSel.value = data.provider;
  updateLinks();
});

providerSel.addEventListener("change", updateLinks);

toggleKeyBtn.addEventListener("click", () => {
  const isPassword = apiKeyInput.type === "password";
  apiKeyInput.type = isPassword ? "text" : "password";
  toggleKeyBtn.title = isPassword ? "Ẩn key" : "Hiện key";
});

function updateLinks() {
  const isGroq = providerSel.value === "groq";
  linkGroq.style.display = isGroq ? "block" : "none";
  linkGemini.style.display = isGroq ? "none" : "block";
  apiKeyInput.placeholder = isGroq ? "gsk_... (từ console.groq.com)" : "AI... (từ aistudio.google.com)";
}

saveBtn.addEventListener("click", () => {
  const apiKey = apiKeyInput.value.trim();
  const minLength = parseInt(minLengthInput.value) || 400;
  const provider = providerSel.value;
  if (!apiKey) { showStatus("Vui lòng nhập API Key", "error"); return; }
  chrome.storage.sync.set({ apiKey, minLength, provider }, () => {
    showStatus("Đã lưu", "success");
  });
});

testBtn.addEventListener("click", async () => {
  const apiKey = apiKeyInput.value.trim();
  const provider = providerSel.value;
  if (!apiKey) { showStatus("Nhập API Key trước", "error"); return; }

  showStatus("Đang test...", "success");
  try {
    const r = await chrome.runtime.sendMessage({ action: "summarize", text: "Test connection. Reply: OK" });
    if (r && r.summary) showStatus("Kết nối thành công", "success");
    else if (r && r.error) showStatus(r.error, "error");
    else showStatus("Không nhận được phản hồi", "error");
  } catch (e) {
    showStatus("Lỗi: " + e.message, "error");
  }
});

function showStatus(msg, type) {
  status.textContent = msg;
  status.className = "status " + type;
  status.style.display = "block";
  setTimeout(() => { status.style.display = "none"; }, 3000);
}
