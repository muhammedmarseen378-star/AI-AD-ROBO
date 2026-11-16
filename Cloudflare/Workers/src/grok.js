// ============================================================================
// Cloudflare Workers Groq AI Integration Module
// Powered by GroqCloud LPU Inference Engine (https://api.groq.com/openai/v1)
// Supports gsk_... API Keys, Llama 3.3 70B, Llama 3.1 8B, Product Research & Voice QA
// ============================================================================

import { encryptSecret, decryptSecret, maskApiKey, generateRandomHex } from './crypto.js';
import { authenticateAdmin, jsonResponse } from './auth.js';

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
const XAI_BASE_URL = 'https://api.x.ai/v1';

const VERIFIED_GROQ_MODELS = [
  { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B (Versatile - Groq LPU)', description: 'Flagship high-performance reasoning model', context_length: 131072 },
  { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B (Instant - Groq LPU)', description: 'Ultra-fast low-latency model for real-time voice', context_length: 131072 },
  { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B (Groq LPU)', description: 'High context window mixture-of-experts model', context_length: 32768 },
  { id: 'gemma2-9b-it', name: 'Gemma 2 9B (Groq LPU)', description: 'Google Gemma 2 on Groq LPU', context_length: 8192 }
];

export function getAiProvider(apiKey) {
  const key = (apiKey || '').trim();
  if (key.startsWith('xai-')) {
    return {
      provider: 'xai',
      name: 'xAI Grok',
      baseUrl: XAI_BASE_URL,
      defaultModel: 'grok-2-1212',
      fallbackModels: [
        { id: 'grok-2-1212', name: 'Grok 2 (Stable - 1212)', description: 'Production general-purpose reasoning model', context_length: 131072 },
        { id: 'grok-beta', name: 'Grok Beta', description: 'Early access flagship preview', context_length: 131072 }
      ]
    };
  }
  // Default: Groq Cloud LPU (Supports gsk_...)
  return {
    provider: 'groq',
    name: 'Groq Cloud LPU',
    baseUrl: GROQ_BASE_URL,
    defaultModel: 'llama-3.3-70b-versatile',
    fallbackModels: VERIFIED_GROQ_MODELS
  };
}

/**
 * Retrieve decrypted active Groq API Key and Active Model from D1 / Worker Secrets
 */
export async function getActiveGrokConfig(env) {
  const secretKey = env.GROK_ENCRYPTION_SECRET || 'MECHATRONICS_GROQ_ENCRYPT_2026';
  
  let keyRow = null;
  let modelRow = null;
  if (env.DB) {
    try {
      keyRow = await env.DB.prepare("SELECT value, is_encrypted FROM system_settings WHERE key = 'grok_api_key'").first();
      modelRow = await env.DB.prepare("SELECT value FROM system_settings WHERE key = 'grok_active_model'").first();
    } catch (e) {}
  }

  let plainApiKey = null;
  if (keyRow && keyRow.value) {
    if (keyRow.is_encrypted) {
      plainApiKey = await decryptSecret(keyRow.value, secretKey);
    } else {
      plainApiKey = keyRow.value;
    }
  }

  // Fallback to Worker environment secret if not set via dashboard D1
  if (!plainApiKey && (env.GROQ_API_KEY || env.GROK_API_KEY)) {
    plainApiKey = env.GROQ_API_KEY || env.GROK_API_KEY;
  }

  const provider = getAiProvider(plainApiKey);
  let activeModel = (modelRow && modelRow.value) ? modelRow.value : (env.DEFAULT_GROQ_MODEL || provider.defaultModel);

  // If using Groq key (gsk_...) but previous model was set to old grok-2, automatically switch to Groq model
  if (plainApiKey && plainApiKey.startsWith('gsk_') && activeModel.startsWith('grok')) {
    activeModel = 'llama-3.3-70b-versatile';
  }

  return {
    apiKey: plainApiKey,
    model: activeModel,
    provider: provider.name,
    baseUrl: provider.baseUrl,
    isConfigured: Boolean(plainApiKey && plainApiKey.trim().length > 0)
  };
}

/**
 * Test an API Key and Model against official Groq or xAI endpoint
 */
async function testAiConnection(apiKey, modelId) {
  if (!apiKey) throw new Error('API key is empty');
  const provider = getAiProvider(apiKey);
  
  let effectiveModel = modelId;
  if (apiKey.startsWith('gsk_') && (modelId.startsWith('grok') || !modelId)) {
    effectiveModel = 'llama-3.3-70b-versatile';
  } else if (!effectiveModel) {
    effectiveModel = provider.defaultModel;
  }

  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey.trim()}`
    },
    body: JSON.stringify({
      model: effectiveModel,
      messages: [
        { role: 'system', content: 'You are a test ping for an autonomous advertisement robot.' },
        { role: 'user', content: 'Ping' }
      ],
      max_tokens: 5,
      temperature: 0.1
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    let parsedMessage = errorBody;
    try {
      const errObj = JSON.parse(errorBody);
      parsedMessage = errObj.error?.message || errObj.message || errorBody;
    } catch {}
    throw new Error(`${provider.name} returned status ${response.status}: ${parsedMessage}`);
  }

  const data = await response.json();
  return { success: true, modelUsed: data.model || effectiveModel, provider: provider.name };
}

/**
 * GET /api/ai/grok/config
 */
export async function handleGetGrokConfig(request, env) {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return jsonResponse({ error: 'Unauthorized. Admin login required.' }, 401);

  const config = await getActiveGrokConfig(env);
  let statusRow = null;
  let errorRow = null;
  if (env.DB) {
    try {
      statusRow = await env.DB.prepare("SELECT value FROM system_settings WHERE key = 'grok_last_tested_at'").first();
      errorRow = await env.DB.prepare("SELECT value FROM system_settings WHERE key = 'grok_last_error'").first();
    } catch (e) {}
  }

  return jsonResponse({
    isConfigured: config.isConfigured,
    maskedKey: config.apiKey ? maskApiKey(config.apiKey) : null,
    activeModel: config.model,
    provider: config.provider,
    lastTestedAt: statusRow?.value || null,
    lastError: errorRow?.value || null
  });
}

/**
 * POST /api/ai/grok/config (Save or update key)
 */
export async function handleSaveGrokConfig(request, env) {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  try {
    const { apiKey, modelId } = await request.json();
    if (!apiKey || apiKey.trim().length === 0) {
      return jsonResponse({ error: 'Groq API Key cannot be empty.' }, 400);
    }

    const provider = getAiProvider(apiKey);
    let effectiveModel = modelId;
    if (apiKey.startsWith('gsk_') && (!effectiveModel || effectiveModel.startsWith('grok'))) {
      effectiveModel = 'llama-3.3-70b-versatile';
    } else if (!effectiveModel) {
      effectiveModel = provider.defaultModel;
    }

    // 1. Validate the new key before saving it
    try {
      await testAiConnection(apiKey, effectiveModel);
    } catch (testErr) {
      if (env.DB) {
        try {
          await env.DB.prepare("INSERT OR REPLACE INTO system_settings (key, value, is_encrypted, description) VALUES ('grok_last_error', ?, 0, 'Last connection error')")
            .bind(testErr.message).run();
        } catch (e) {}
      }
      return jsonResponse({ 
        error: `Validation failed on ${provider.name}: ${testErr.message}. Existing working configuration was preserved.` 
      }, 400);
    }

    // 2. Encrypt the validated key using AES-GCM
    const secretKey = env.GROK_ENCRYPTION_SECRET || 'MECHATRONICS_GROQ_ENCRYPT_2026';
    const encryptedKey = await encryptSecret(apiKey.trim(), secretKey);
    const masked = maskApiKey(apiKey.trim());
    const nowIso = new Date().toISOString();

    // 3. Persist in D1 if bound
    if (env.DB) {
      try {
        await env.DB.batch([
          env.DB.prepare("INSERT OR REPLACE INTO system_settings (key, value, is_encrypted, description) VALUES ('grok_api_key', ?, 1, 'Encrypted Groq API Key')").bind(encryptedKey),
          env.DB.prepare("INSERT OR REPLACE INTO system_settings (key, value, is_encrypted, description) VALUES ('grok_active_model', ?, 0, 'Active model')").bind(effectiveModel),
          env.DB.prepare("INSERT OR REPLACE INTO system_settings (key, value, is_encrypted, description) VALUES ('grok_api_configured', 'true', 0, 'AI API configuration flag')"),
          env.DB.prepare("INSERT OR REPLACE INTO system_settings (key, value, is_encrypted, description) VALUES ('grok_api_masked_key', ?, 0, 'Masked key for UI display')").bind(masked),
          env.DB.prepare("INSERT OR REPLACE INTO system_settings (key, value, is_encrypted, description) VALUES ('grok_last_tested_at', ?, 0, 'Timestamp of verified connection')").bind(nowIso),
          env.DB.prepare("INSERT OR REPLACE INTO system_settings (key, value, is_encrypted, description) VALUES ('grok_last_error', '', 0, 'Cleared on success')"),
          env.DB.prepare("INSERT INTO activity_logs (id, actor, action, details) VALUES (?, ?, ?, ?)").bind(
            generateRandomHex(16),
            `admin:${admin.email}`,
            'GROQ_CONFIG_UPDATED',
            `Groq API key updated and verified. Masked: ${masked}`
          )
        ]);
      } catch (dbErr) {
        // Continue even if D1 throws
      }
    }

    return jsonResponse({
      success: true,
      message: `${provider.name} API Key validated and securely configured!`,
      maskedKey: masked,
      provider: provider.name,
      activeModel: effectiveModel,
      verifiedAt: nowIso
    });
  } catch (err) {
    return jsonResponse({ error: 'Failed to save configuration: ' + err.message }, 500);
  }
}

/**
 * POST /api/ai/grok/test (Test current active configuration)
 */
export async function handleTestGrokConnection(request, env) {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  const config = await getActiveGrokConfig(env);
  if (!config.apiKey) {
    return jsonResponse({ error: 'No Groq API key is configured. Please enter your gsk_... key and save first.' }, 400);
  }

  try {
    const startTime = Date.now();
    const result = await testAiConnection(config.apiKey, config.model);
    const latency = Date.now() - startTime;
    const nowIso = new Date().toISOString();

    if (env.DB) {
      try {
        await env.DB.prepare("INSERT OR REPLACE INTO system_settings (key, value, is_encrypted, description) VALUES ('grok_last_tested_at', ?, 0, 'Last test timestamp')")
          .bind(nowIso).run();
        await env.DB.prepare("INSERT INTO ai_logs (id, model_used, request_type, status, duration_ms) VALUES (?, ?, ?, ?, ?)")
          .bind(generateRandomHex(16), config.model, 'TEST', 'SUCCESS', latency).run();
      } catch (e) {}
    }

    return jsonResponse({
      success: true,
      message: `Successfully connected to ${result.provider} using ${result.modelUsed}`,
      modelUsed: result.modelUsed,
      provider: result.provider,
      latencyMs: latency,
      testedAt: nowIso
    });
  } catch (err) {
    if (env.DB) {
      try {
        await env.DB.prepare("INSERT OR REPLACE INTO system_settings (key, value, is_encrypted, description) VALUES ('grok_last_error', ?, 0, 'Last error')")
          .bind(err.message).run();
      } catch (e) {}
    }
    return jsonResponse({ error: err.message }, 500);
  }
}

/**
 * GET /api/ai/grok/models (List supported/available Groq models)
 */
export async function handleListGrokModels(request, env) {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  const config = await getActiveGrokConfig(env);
  const provider = getAiProvider(config.apiKey);
  
  if (config.apiKey) {
    try {
      const response = await fetch(`${provider.baseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${config.apiKey.trim()}` }
      });
      if (response.ok) {
        const body = await response.json();
        if (Array.isArray(body.data) && body.data.length > 0) {
          const models = body.data.map(m => ({
            id: m.id,
            name: `${m.id} (${provider.name})`,
            description: `Model: ${m.id}`,
            context_length: m.context_window || 131072
          }));
          return jsonResponse({ models, activeModel: config.model, provider: provider.name, source: 'live_api' });
        }
      }
    } catch (e) {
      console.warn('Could not query live Groq models list, using verified fallback list:', e.message);
    }
  }

  return jsonResponse({ models: provider.fallbackModels, activeModel: config.model, provider: provider.name, source: 'verified_catalog' });
}

/**
 * POST /api/ai/grok/select-model
 */
export async function handleSelectGrokModel(request, env) {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  try {
    const { modelId } = await request.json();
    if (!modelId) return jsonResponse({ error: 'Model ID is required' }, 400);

    const config = await getActiveGrokConfig(env);
    if (config.apiKey) {
      await testAiConnection(config.apiKey, modelId);
    }

    if (env.DB) {
      try {
        await env.DB.prepare("INSERT OR REPLACE INTO system_settings (key, value, is_encrypted, description) VALUES ('grok_active_model', ?, 0, 'Active model')")
          .bind(modelId).run();
        await env.DB.prepare("INSERT INTO activity_logs (id, actor, action, details) VALUES (?, ?, ?, ?)").bind(
          generateRandomHex(16),
          `admin:${admin.email}`,
          'MODEL_CHANGED',
          `Active Groq model set to ${modelId}`
        ).run();
      } catch (e) {}
    }

    return jsonResponse({ success: true, message: `Model ${modelId} activated successfully.`, activeModel: modelId });
  } catch (err) {
    return jsonResponse({ error: 'Failed to activate model: ' + err.message }, 400);
  }
}

/**
 * POST /api/products/ai-research (Groq AI Product Research)
 */
export async function handleAiProductResearch(request, env) {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  const { productName, brand, categoryName, modelNumber } = await request.json();
  if (!productName) return jsonResponse({ error: 'Product name is required for AI research.' }, 400);

  const config = await getActiveGrokConfig(env);
  if (!config.apiKey) {
    return jsonResponse({ error: 'Groq API Key is not configured. Please enter your gsk_... key in Settings.' }, 400);
  }

  const provider = getAiProvider(config.apiKey);
  const prompt = `You are an expert product analyst and copywriter for an autonomous mechatronic advertisement robot.
Generate verified, realistic product details for:
Product Name: "${productName}"
Brand: "${brand || 'Unknown'}"
Category: "${categoryName || 'General'}"
Model: "${modelNumber || 'Standard'}"

STRICT RULES:
1. Never invent fake government certifications or impossible specs.
2. If exact price is not verified, return 0 for price.
3. Provide a clear, compelling English description (under 250 words).
4. Provide an accurate Malayalam translation (മലയാളം വിവരണം) suitable for South Indian customers.
5. Provide 4 concise bullet features.
6. Provide 4-6 key technical specifications (key-value pairs).
7. Provide 2 common customer FAQs with helpful answers.

Format your response STRICTLY as valid JSON with no markdown backticks, adhering to this structure:
{
  "description": "...",
  "description_ml": "...",
  "features": ["Feature 1", "Feature 2", "Feature 3", "Feature 4"],
  "specs": {"Specification 1": "Value 1", "Specification 2": "Value 2"},
  "faqs": [{"q": "Question 1", "a": "Answer 1"}, {"q": "Question 2", "a": "Answer 2"}],
  "suggested_promo": "...",
  "is_verified": false
}`;

  try {
    const startTime = Date.now();
    const res = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey.trim()}`
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: 'You are an AI research assistant. Respond strictly in valid JSON format without markdown code fences.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 1200
      })
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`${provider.name} error: ${err}`);
    }

    const data = await res.json();
    const rawContent = data.choices?.[0]?.message?.content || '{}';
    const cleanedJson = rawContent.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleanedJson);

    const duration = Date.now() - startTime;
    if (env.DB) {
      try {
        await env.DB.prepare("INSERT INTO ai_logs (id, model_used, request_type, status, duration_ms) VALUES (?, ?, ?, ?, ?)")
          .bind(generateRandomHex(16), config.model, 'PRODUCT_RESEARCH', 'SUCCESS', duration).run();
      } catch (e) {}
    }

    return jsonResponse({ success: true, data: parsed, modelUsed: config.model, provider: provider.name });
  } catch (err) {
    return jsonResponse({ error: 'AI Research failed: ' + err.message }, 500);
  }
}

/**
 * POST /api/ai/voice/ask (Customer Voice Q&A via Groq)
 */
export async function handleCustomerVoiceQuestion(request, env) {
  const { question, language, activeAdId } = await request.json();
  if (!question || question.trim().length === 0) {
    return jsonResponse({ error: 'Question text is required.' }, 400);
  }

  const config = await getActiveGrokConfig(env);
  if (!config.apiKey) {
    return jsonResponse({ 
      answer: "I am sorry, the AI connection is currently offline. Please configure your Groq API key in the admin panel.",
      language: language || 'en-IN'
    });
  }

  const provider = getAiProvider(config.apiKey);
  let productContext = "Autonomous smart advertisement robot.";
  if (env.DB) {
    try {
      const activeAd = await env.DB.prepare(`
        SELECT a.title, a.short_desc, a.detailed_desc, a.price, a.features, a.promo_info, 
               p.name as product_name, p.specs_json, p.faq_json, p.availability
        FROM advertisements a
        LEFT JOIN products p ON a.product_id = p.id
        WHERE a.status = 'active' OR a.id = ?
        LIMIT 1
      `).bind(activeAdId || '').first();

      if (activeAd) {
        productContext = `Currently Displayed Advertisement: "${activeAd.title}".
Product: "${activeAd.product_name || activeAd.title}".
Price: ₹${activeAd.price || 'Contact for price'}.
Availability: ${activeAd.availability || 'Inquire'}.
Features: ${activeAd.features || activeAd.short_desc}.
Promotions: ${activeAd.promo_info || 'None currently active'}.
Details: ${activeAd.detailed_desc || ''}.`;
      }
    } catch (e) {
      console.error('Error fetching context:', e);
    }
  }

  const userLang = language || 'en-IN';
  const systemPrompt = `You are the AI Voice Assistant for an autonomous Smart Advertisement Robot.
Context about the product currently on display:
${productContext}

RULES:
1. Speak in a friendly, concise, natural tone suitable for robot text-to-speech.
2. Keep answers within 1 to 3 sentences (under 50 words) so audio playback is snappy.
3. NEVER invent prices, discounts, or specifications not mentioned in the context.
4. If asked about price or offers, quote only what is confirmed in the context.
5. If the user speaks Malayalam or asks in Malayalam, answer fluently in Malayalam script. Otherwise answer in English.`;

  try {
    const res = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey.trim()}`
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: question }
        ],
        temperature: 0.2,
        max_tokens: 150
      })
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`${provider.name} error: ${err}`);
    }

    const data = await res.json();
    const answer = data.choices?.[0]?.message?.content || 'I could not process your question at this moment.';
    return jsonResponse({ answer, modelUsed: config.model, provider: provider.name });
  } catch (err) {
    return jsonResponse({ 
      answer: "I am having trouble answering right now. Please check back shortly.",
      error: err.message 
    }, 500);
  }
}
