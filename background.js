// Background service worker

// === CONTEXT MENU ===
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "summarize-selection",
    title: "Tóm tắt đoạn text này",
    contexts: ["selection"],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "summarize-selection" && info.selectionText) {
    chrome.tabs.sendMessage(tab.id, {
      action: "summarize-selection",
      text: info.selectionText,
    });
  }
});

// === BADGE COUNTER ===
let dailyCount = 0;
let lastDate = "";

async function incrementBadge() {
  const today = new Date().toDateString();
  const data = await chrome.storage.local.get(["dailyCount", "lastDate"]);
  if (data.lastDate !== today) {
    dailyCount = 0;
    lastDate = today;
  } else {
    dailyCount = data.dailyCount || 0;
  }
  dailyCount++;
  await chrome.storage.local.set({ dailyCount, lastDate: today });
  chrome.action.setBadgeText({ text: dailyCount.toString() });
  chrome.action.setBadgeBackgroundColor({ color: "#6c5ce7" });
}

// Reset badge on startup
chrome.runtime.onStartup.addListener(async () => {
  const today = new Date().toDateString();
  const data = await chrome.storage.local.get(["dailyCount", "lastDate"]);
  if (data.lastDate === today) {
    chrome.action.setBadgeText({ text: (data.dailyCount || 0).toString() });
    chrome.action.setBadgeBackgroundColor({ color: "#6c5ce7" });
  }
});

// === DEFAULT PROMPT ===
const DEFAULT_PROMPT = `Tóm tắt bài viết dưới đây. Quy tắc bắt buộc:
- CHỈ dùng thông tin có trong bài viết, KHÔNG thêm, KHÔNG suy luận, KHÔNG bịa.
- Trả về 3-5 bullet points (dùng "•"), mỗi ý 1-2 câu ngắn gọn.
- Không mở đầu, không kết luận, không giải thích thêm. Chỉ trả về các dòng tóm tắt.`;

async function getSystemPrompt(outputLang) {
  const data = await chrome.storage.sync.get(["customPrompt", "outputLang"]);
  const lang = outputLang || data.outputLang || "auto";
  let prompt = data.customPrompt || DEFAULT_PROMPT;

  if (lang === "vi") prompt += "\n- Luôn trả lời bằng tiếng Việt, dịch nếu bài viết bằng ngôn ngữ khác.";
  else if (lang === "en") prompt += "\n- Always respond in English, translate if the post is in another language.";
  else prompt += "\n- Nếu bài viết bằng tiếng Anh hoặc ngôn ngữ khác tiếng Việt, dịch tóm tắt sang tiếng Việt. Nếu bằng tiếng Việt, giữ nguyên.";

  return prompt;
}

// === MESSAGE HANDLER ===
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "summarize") {
    handleSummarize(request.text).then(sendResponse);
    return true;
  }
});

async function handleSummarize(text) {
  try {
    const data = await chrome.storage.sync.get(["apiKey", "provider"]);
    const apiKey = data.apiKey;
    const provider = data.provider || "groq";

    if (!apiKey) {
      return { error: "Chưa nhập API Key. Click icon extension để cài đặt." };
    }

    const systemPrompt = await getSystemPrompt();
    const callFn = provider === "groq" ? callGroq : callGemini;

    for (let attempt = 0; attempt <= 2; attempt++) {
      const result = await callFn(apiKey, text, systemPrompt);
      if (!result.rateLimited) {
        if (result.summary) {
          incrementBadge();
          // Save to history
          saveHistory(text, result.summary);
        }
        return result;
      }
      await new Promise(r => setTimeout(r, (attempt + 1) * 3000));
    }

    return { error: "API đang quá tải. Vui lòng thử lại sau vài phút." };
  } catch (e) {
    return { error: "Lỗi: " + e.message };
  }
}

// === HISTORY ===
async function saveHistory(text, summary) {
  const data = await chrome.storage.local.get("history");
  const history = data.history || [];
  history.unshift({
    text: text.substring(0, 200),
    summary,
    date: new Date().toISOString(),
    site: "unknown",
  });
  // Keep last 50
  if (history.length > 50) history.length = 50;
  await chrome.storage.local.set({ history });
}

// === API CALLS ===
async function callGroq(apiKey, text, systemPrompt) {
  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
      temperature: 0.3,
      max_tokens: 512,
    }),
  });
  if (resp.status === 429) return { rateLimited: true };
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    return { error: "Groq API lỗi: " + (err.error?.message || resp.statusText) };
  }
  const result = await resp.json();
  return { summary: result.choices?.[0]?.message?.content || "Không thể tóm tắt." };
}

async function callGemini(apiKey, text, systemPrompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: systemPrompt + "\n\nBài viết:\n" + text }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 512 },
    }),
  });
  if (resp.status === 429) return { rateLimited: true };
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    return { error: "Gemini API lỗi: " + (err.error?.message || resp.statusText) };
  }
  const result = await resp.json();
  return { summary: result.candidates?.[0]?.content?.parts?.[0]?.text || "Không thể tóm tắt." };
}
