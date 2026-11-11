import type { AIProviderInfo } from './types.ts';

/** The AI accounts Talaria can use, in the order setup offers them. */
export const AI_PROVIDERS: AIProviderInfo[] = [
  { id: 'openai-codex', label: 'ChatGPT', name: 'ChatGPT', auth: 'chatgpt', webSearch: 'native' },
  { id: 'copilot', label: 'GitHub Copilot', name: 'Copilot', auth: 'copilot', webSearch: 'talaria' },
  {
    id: 'gemini',
    label: 'Google Gemini',
    name: 'Gemini',
    auth: 'key',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyHint: 'Free: sign in to Google AI Studio and press Create API key.',
    webSearch: 'talaria',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    name: 'OpenRouter',
    auth: 'key',
    keyUrl: 'https://openrouter.ai/settings/keys',
    keyHint: 'One key for hundreds of models, paid per use (a few free ones too).',
    webSearch: 'talaria',
  },
  {
    id: 'anthropic',
    label: 'Claude (API key)',
    name: 'Claude',
    auth: 'key',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyHint: 'A key from the Claude Console, paid per use. A Claude Pro or Max plan is separate and can’t be used here.',
    webSearch: 'talaria',
  },
  {
    id: 'openai',
    label: 'OpenAI (API key)',
    name: 'OpenAI',
    auth: 'key',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyHint: 'A key from the OpenAI Platform, paid per use. For a ChatGPT plan, pick ChatGPT instead.',
    webSearch: 'talaria',
  },
  {
    id: 'groq',
    label: 'Groq',
    name: 'Groq',
    auth: 'key',
    keyUrl: 'https://console.groq.com/keys',
    keyHint: 'Very fast open models, with a free tier.',
    webSearch: 'talaria',
  },
  {
    id: 'xai',
    label: 'xAI Grok',
    name: 'Grok',
    auth: 'key',
    keyUrl: 'https://console.x.ai',
    keyHint: 'A key from the xAI Console, paid per use.',
    webSearch: 'talaria',
  },
];

export const aiProviderLabel = (id?: string) => AI_PROVIDERS.find(p => p.id === id)?.label || id || 'The AI provider';

/**
 * The connected AI's own name, for anything the AI does: "ChatGPT is reading your resume",
 * "Ask Claude to revise". Before any AI is connected it's just "AI".
 */
export const aiShortName = (id?: string) => AI_PROVIDERS.find(p => p.id === id)?.name || 'AI';
