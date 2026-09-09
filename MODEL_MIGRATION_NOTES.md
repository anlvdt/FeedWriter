# Model Migration Notes - August 2026

## 🔄 Migration Summary

**Date**: August 18, 2026  
**Reason**: Groq deprecated `llama-3.3-70b-versatile` model on June 17, 2026, with full shutdown scheduled for August 2026.

## ⚠️ Deprecated Models

### Groq
- **OLD**: `llama-3.3-70b-versatile`
- **NEW**: `openai/gpt-oss-120b`
- **Status**: ❌ Deprecated (shutdown Aug 2026)
- **Reason**: OpenAI released GPT-OSS open-weight models, Groq switched to these for better performance

### OpenRouter
- **OLD**: `meta-llama/llama-3.3-70b-instruct`
- **NEW**: `openai/gpt-oss-120b`
- **Status**: ⚠️ Phasing out
- **Reason**: Aligning with industry shift to GPT-OSS models

## ✅ Current Models (No Changes Required)

### Gemini
- **Model**: `gemini-2.0-flash`
- **Status**: ✅ Active and supported
- **Notes**: Latest flash model from Google, excellent performance

### Cerebras
- **Model**: `gpt-oss-120b`
- **Status**: ✅ Active and supported
- **Notes**: Already using GPT-OSS, no changes needed

### SambaNova
- **Model**: `Meta-Llama-3.3-70B-Instruct`
- **Status**: ✅ Active and supported (as of Aug 2026)
- **Notes**: Still in production models list on SambaNova

## 📋 Files Updated

1. **bg-api.js**
   - `callGroqStream()` - Updated to `openai/gpt-oss-120b`
   - `callOpenrouterStream()` - Updated to `openai/gpt-oss-120b`
   - `callOpenrouterNonStream()` - Updated to `openai/gpt-oss-120b`

2. **service-worker.js**
   - `callGroqStream()` - Updated to `openai/gpt-oss-120b`
   - `callGroqNonStream()` - Updated to `openai/gpt-oss-120b`
   - `callOpenrouterStream()` - Updated to `openai/gpt-oss-120b`
   - `callOpenrouterNonStream()` - Updated to `openai/gpt-oss-120b`

3. **background.js**
   - `callGroqNonStream()` - Updated to `openai/gpt-oss-120b`

## 🆕 About GPT-OSS-120B

**GPT-OSS-120B** is OpenAI's first open-weight reasoning model:
- **Total Parameters**: 120B (Mixture-of-Experts architecture)
- **Active Parameters**: 5.1B per forward pass
- **Context Window**: 131K tokens
- **Key Features**:
  - Chain-of-thought reasoning
  - Structured outputs support
  - Tool calling capabilities
  - Similar performance to GPT-4 class models
  - Much faster inference than traditional 70B models

### Performance on Groq
- **Speed**: ~500 tokens/second
- **TTFT**: 0.74 seconds (time to first token)
- **Cost**: $0.15/1M input tokens, $0.60/1M output tokens
- **Cache discount**: 50% off for cached inputs

### Performance on Cerebras
- **Speed**: ~2,700-3,000 tokens/second (15x faster than GPU)
- **TTFT**: 280 milliseconds
- **Cost**: $0.25/1M input tokens, $0.69/1M output tokens

## 🔍 Testing Recommendations

After deploying these changes, test:
1. ✅ API key validation for all providers
2. ✅ Summary generation with streaming
3. ✅ AI review functionality (non-stream)
4. ✅ Cross-provider fallback logic
5. ✅ Rate limit handling

## 📚 References

- [Groq Deprecation Notice](https://markaicode.com/vs/groq-vs-openai-api/)
- [OpenAI GPT-OSS Announcement](https://openai.com/index/introducing-gpt-oss/)
- [Cerebras GPT-OSS Support](https://www.cerebras.ai/blog/openai-gpt-oss-120b-runs-fastest-on-cerebras)
- [SambaNova Models List](https://docs-prod.sambanova.ai/docs/en/models/sambacloud-models)

## 🔮 Future Considerations

- Monitor SambaNova for potential `Meta-Llama-3.3-70B-Instruct` deprecation
- Consider adding newer models like:
  - `gpt-oss-20b` (smaller, faster alternative)
  - `qwen/qwen3.6-27b` (Groq recommended alternative)
  - `deepseek-v3` (SambaNova's new flagship)
  - `gemma-4-31b` (SambaNova reasoning model)

## ⚙️ Rollback Plan

If issues occur with new models:
1. Check API keys are valid for new model names
2. Verify provider APIs haven't changed authentication
3. Monitor error logs for model-specific errors
4. As last resort, can temporarily revert to old models (but they will stop working in Aug 2026)
