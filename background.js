// Background service worker - gọi AI API để tóm tắt
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "summarize") {
    handleSummarize(request.text).then(sendResponse);
    return true;
  }
});

const SYSTEM_PROMPT = `Tóm tắt bài viết Facebook dưới đây. Quy tắc bắt buộc:
- CHỈ dùng thông tin có trong bài viết, KHÔNG thêm, KHÔNG suy luận, KHÔNG bịa.
- Nếu bài viết bằng tiếng Anh hoặc ngôn ngữ khác tiếng Việt, hãy dịch tóm tắt sang tiếng Việt.
- Nếu bài viết bằng tiếng Việt, giữ nguyên tiếng Việt.
- Trả về 3-5 bullet points (dùng "•"), mỗi ý 1-2 câu ngắn gọn.
- Không mở đầu, không kết luận, không giải thích thêm. Chỉ trả về các dòng tóm tắt.`;

async function handleSummarize(text) {
  try {
    const data = await chrome.storage.sync.get(["apiKey", "provider"]);
    const apiKey = data.apiKey;
    const provider = data.provider || "groq";

    if (!apiKey) {
      return { error: "Chưa nhập API Key. Click icon extension để cài đặt." };
    }

    const callFn = provider === "groq" ? callGroq : callGemini;
    const maxRetries = 2;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const result = await callFn(apiKey, text);
      if (!result.rateLimited) return result;
      // Rate limited — wait and retry
      const wait = (attempt + 1) * 3000;
      await new Promise(r => setTimeout(r, wait));
    }

    return { error: "API đang quá tải. Vui lòng thử lại sau vài phút." };
  } catch (e) {
    return { error: "Lỗi: " + e.message };
  }
}

async function callGroq(apiKey, text) {
  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + apiKey,
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
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

async function callGemini(apiKey, text) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: SYSTEM_PROMPT + "\n\nBài viết:\n" + text }] }],
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
