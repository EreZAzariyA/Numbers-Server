import OpenAI from 'openai';

const OLLAMA_DEFAULT_BASE_URL = 'http://localhost:11434/v1';
const OLLAMA_API_KEY = 'ollama';

// Shared factory for the OpenAI-compatible Ollama client. Reads OLLAMA_BASE_URL
// at call time, falling back to the local default.
export const createOllamaClient = (): OpenAI =>
  new OpenAI({
    baseURL: process.env.OLLAMA_BASE_URL || OLLAMA_DEFAULT_BASE_URL,
    apiKey: OLLAMA_API_KEY,
  });
