#!/usr/bin/env node

/**
 * FeedWriter API Keys Test Script
 * 
 * Test API keys với các models mới sau khi migration.
 * 
 * Usage:
 *   node test-api-keys.js
 * 
 * Hoặc test một provider cụ thể:
 *   PROVIDER=groq node test-api-keys.js
 *   PROVIDER=gemini API_KEY=your-key node test-api-keys.js
 */

const https = require('https');

// ==================== CONFIG ====================
const TEST_PROMPT = "Reply with exactly: OK";
const TEST_SYSTEM = "You are a test bot. Reply OK.";
const TIMEOUT_MS = 30000;

// Models configuration sau migration
const MODELS = {
  groq: "openai/gpt-oss-120b",
  gemini: "gemini-2.0-flash",
  cerebras: "gpt-oss-120b",
  sambanova: "Meta-Llama-3.3-70B-Instruct",
  openrouter: "openai/gpt-oss-120b"
};

// ==================== UTILITIES ====================
function log(msg, color = '') {
  const colors = {
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[36m',
    reset: '\x1b[0m'
  };
  console.log((colors[color] || '') + msg + colors.reset);
}

function makeRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: JSON.parse(data)
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: data
          });
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ==================== PROVIDER TESTS ====================

async function testGroq(apiKey) {
  log('Testing Groq API...', 'blue');
  try {
    const response = await makeRequest({
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    }, {
      model: MODELS.groq,
      messages: [
        { role: 'system', content: TEST_SYSTEM },
        { role: 'user', content: TEST_PROMPT }
      ],
      max_tokens: 50,
      temperature: 0.3
    });

    if (response.status === 200 && response.body.choices) {
      const reply = response.body.choices[0]?.message?.content || '';
      log(`✓ Groq (${MODELS.groq}): ${reply.substring(0, 50)}`, 'green');
      return { success: true, provider: 'Groq', model: MODELS.groq, reply };
    } else {
      log(`✗ Groq failed: ${response.body.error?.message || JSON.stringify(response.body)}`, 'red');
      return { success: false, error: response.body.error?.message || 'Unknown error' };
    }
  } catch (e) {
    log(`✗ Groq error: ${e.message}`, 'red');
    return { success: false, error: e.message };
  }
}

async function testGemini(apiKey) {
  log('Testing Gemini API...', 'blue');
  try {
    const response = await makeRequest({
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/${MODELS.gemini}:generateContent?key=${apiKey}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, {
      system_instruction: { parts: [{ text: TEST_SYSTEM }] },
      contents: [{ parts: [{ text: TEST_PROMPT }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 50 }
    });

    if (response.status === 200 && response.body.candidates) {
      const reply = response.body.candidates[0]?.content?.parts?.[0]?.text || '';
      log(`✓ Gemini (${MODELS.gemini}): ${reply.substring(0, 50)}`, 'green');
      return { success: true, provider: 'Gemini', model: MODELS.gemini, reply };
    } else {
      log(`✗ Gemini failed: ${response.body.error?.message || JSON.stringify(response.body)}`, 'red');
      return { success: false, error: response.body.error?.message || 'Unknown error' };
    }
  } catch (e) {
    log(`✗ Gemini error: ${e.message}`, 'red');
    return { success: false, error: e.message };
  }
}

async function testCerebras(apiKey) {
  log('Testing Cerebras API...', 'blue');
  try {
    const response = await makeRequest({
      hostname: 'api.cerebras.ai',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    }, {
      model: MODELS.cerebras,
      messages: [
        { role: 'system', content: TEST_SYSTEM },
        { role: 'user', content: TEST_PROMPT }
      ],
      max_tokens: 50,
      temperature: 0.3
    });

    if (response.status === 200 && response.body.choices) {
      const reply = response.body.choices[0]?.message?.content || '';
      log(`✓ Cerebras (${MODELS.cerebras}): ${reply.substring(0, 50)}`, 'green');
      return { success: true, provider: 'Cerebras', model: MODELS.cerebras, reply };
    } else {
      log(`✗ Cerebras failed: ${response.body.error?.message || JSON.stringify(response.body)}`, 'red');
      return { success: false, error: response.body.error?.message || 'Unknown error' };
    }
  } catch (e) {
    log(`✗ Cerebras error: ${e.message}`, 'red');
    return { success: false, error: e.message };
  }
}

async function testSambaNova(apiKey) {
  log('Testing SambaNova API...', 'blue');
  try {
    const response = await makeRequest({
      hostname: 'api.sambanova.ai',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    }, {
      model: MODELS.sambanova,
      messages: [
        { role: 'system', content: TEST_SYSTEM },
        { role: 'user', content: TEST_PROMPT }
      ],
      max_tokens: 50,
      temperature: 0.3
    });

    if (response.status === 200 && response.body.choices) {
      const reply = response.body.choices[0]?.message?.content || '';
      log(`✓ SambaNova (${MODELS.sambanova}): ${reply.substring(0, 50)}`, 'green');
      return { success: true, provider: 'SambaNova', model: MODELS.sambanova, reply };
    } else {
      log(`✗ SambaNova failed: ${response.body.error?.message || JSON.stringify(response.body)}`, 'red');
      return { success: false, error: response.body.error?.message || 'Unknown error' };
    }
  } catch (e) {
    log(`✗ SambaNova error: ${e.message}`, 'red');
    return { success: false, error: e.message };
  }
}

async function testOpenRouter(apiKey) {
  log('Testing OpenRouter API...', 'blue');
  try {
    const response = await makeRequest({
      hostname: 'openrouter.ai',
      path: '/api/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/anlvdt/fb-post-summarizer',
        'X-Title': 'FeedWriter'
      }
    }, {
      model: MODELS.openrouter,
      messages: [
        { role: 'system', content: TEST_SYSTEM },
        { role: 'user', content: TEST_PROMPT }
      ],
      max_tokens: 50,
      temperature: 0.3
    });

    if (response.status === 200 && response.body.choices) {
      const reply = response.body.choices[0]?.message?.content || '';
      log(`✓ OpenRouter (${MODELS.openrouter}): ${reply.substring(0, 50)}`, 'green');
      return { success: true, provider: 'OpenRouter', model: MODELS.openrouter, reply };
    } else {
      log(`✗ OpenRouter failed: ${response.body.error?.message || JSON.stringify(response.body)}`, 'red');
      return { success: false, error: response.body.error?.message || 'Unknown error' };
    }
  } catch (e) {
    log(`✗ OpenRouter error: ${e.message}`, 'red');
    return { success: false, error: e.message };
  }
}

// ==================== MAIN ====================

async function detectProvider(key) {
  if (!key) return null;
  if (key.startsWith('gsk_')) return 'groq';
  if (key.startsWith('AIza')) return 'gemini';
  if (key.startsWith('csk-')) return 'cerebras';
  if (key.length === 36 && key.includes('-')) return 'sambanova'; // UUID format
  if (key.startsWith('sk-or-')) return 'openrouter';
  return null;
}

async function main() {
  log('\n=== FeedWriter API Keys Test ===\n', 'yellow');
  log('Models after migration:');
  Object.entries(MODELS).forEach(([provider, model]) => {
    log(`  ${provider}: ${model}`);
  });
  log('');

  const targetProvider = process.env.PROVIDER?.toLowerCase();
  const apiKey = process.env.API_KEY;

  if (apiKey) {
    // Test single key
    const provider = targetProvider || await detectProvider(apiKey);
    if (!provider) {
      log('Could not detect provider from API key. Use PROVIDER env var.', 'red');
      process.exit(1);
    }

    log(`Testing single key for provider: ${provider}\n`, 'yellow');
    
    const testFns = {
      groq: testGroq,
      gemini: testGemini,
      cerebras: testCerebras,
      sambanova: testSambaNova,
      openrouter: testOpenRouter
    };

    const result = await testFns[provider](apiKey);
    
    if (result.success) {
      log(`\n✓ Test passed!`, 'green');
      process.exit(0);
    } else {
      log(`\n✗ Test failed: ${result.error}`, 'red');
      process.exit(1);
    }
  } else {
    // Show instructions
    log('No API_KEY provided. Please provide API key:\n', 'yellow');
    log('Usage examples:', 'blue');
    log('  API_KEY=gsk_... node test-api-keys.js');
    log('  API_KEY=AIza... PROVIDER=gemini node test-api-keys.js');
    log('  API_KEY=csk-... node test-api-keys.js\n');
    
    log('Or test through the extension:', 'blue');
    log('  1. Load extension in Chrome');
    log('  2. Click extension icon → API Keys tab');
    log('  3. Add your API key');
    log('  4. Click "Test kết nối" button\n');
    
    log('Get free API keys:', 'green');
    log('  Groq:      https://console.groq.com/keys');
    log('  Cerebras:  https://cloud.cerebras.ai');
    log('  SambaNova: https://cloud.sambanova.ai');
    log('  Gemini:    https://aistudio.google.com/apikey');
    log('  OpenRouter: https://openrouter.ai/keys\n');
  }
}

main().catch(err => {
  log(`Fatal error: ${err.message}`, 'red');
  process.exit(1);
});
