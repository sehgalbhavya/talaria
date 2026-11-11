import { aiShortName } from '@shared/aiProviders';
import { useApp } from './store';

/**
 * The connected AI's name ("ChatGPT", "Claude", "Copilot"…), used wherever the app says what the AI
 * is doing: "ChatGPT is reading your resume". It's "AI" until one is connected. The app root
 * re-renders when the provider changes, so plain calls during render stay current.
 */
export const aiName = () => aiShortName(useApp.getState().settings?.ai.provider);
