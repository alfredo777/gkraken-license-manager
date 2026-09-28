// npm run seed:ai — crea los proveedores de IA (sin claves) y los modelos de Claude.
// Los ids de modelo de otros proveedores se agregan desde el panel (/dashboard/ai)
// con el id exacto que publique cada proveedor.
require('dotenv').config();
const { sequelize, AiProvider, AiModel } = require('../models');

const PROVIDERS = [
  { slug: 'anthropic', name: 'Anthropic (Claude)', api_format: 'anthropic', base_url: 'https://api.anthropic.com' },
  { slug: 'xai', name: 'xAI (Grok)', api_format: 'openai', base_url: 'https://api.x.ai/v1' },
  { slug: 'openai', name: 'OpenAI (ChatGPT)', api_format: 'openai', base_url: 'https://api.openai.com/v1' },
  { slug: 'google', name: 'Google (Gemini)', api_format: 'gemini', base_url: 'https://generativelanguage.googleapis.com/v1beta' },
  { slug: 'deepseek', name: 'DeepSeek', api_format: 'openai', base_url: 'https://api.deepseek.com/v1' },
  { slug: 'qwen', name: 'Alibaba (Qwen)', api_format: 'openai', base_url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1' }
];

// Costos de referencia de Anthropic (USD por millón de tokens, entrada/salida).
const CLAUDE = [
  { model_id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', cost_input_per_mtok: 4, cost_output_per_mtok: 20, token_factor: 4, max_output_tokens: 32000 },
  { model_id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5', cost_input_per_mtok: 2, cost_output_per_mtok: 10, token_factor: 2, max_output_tokens: 32000 },
  { model_id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5', cost_input_per_mtok: 1, cost_output_per_mtok: 5, token_factor: 1, max_output_tokens: 16000 }
];

(async () => {
  try {
    await sequelize.sync();
    for (const p of PROVIDERS) await AiProvider.findOrCreate({ where: { slug: p.slug }, defaults: { ...p, enabled: false } });
    const anthropic = await AiProvider.findOne({ where: { slug: 'anthropic' } });
    for (const m of CLAUDE) await AiModel.findOrCreate({ where: { provider_id: anthropic.id, model_id: m.model_id }, defaults: { ...m, provider_id: anthropic.id } });
    console.log('✅ Proveedores y modelos de Claude listos. Agrega las claves y activa los proveedores en /dashboard/ai.');
  } catch (e) {
    console.error('❌', e.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
})();
