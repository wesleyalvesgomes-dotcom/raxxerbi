import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';
import {
  SECOND_BRAIN_SYSTEM_INSTRUCTION,
  ONBOARDING_RESPONSE_SCHEMA,
  EXTRACT_MEMORY_RESPONSE_SCHEMA,
  WEEKLY_REVIEW_RESPONSE_SCHEMA,
  CHAT_RESPONSE_SCHEMA,
  buildOnboardingPrompt,
  buildPrioritiesPrompt,
  buildExtractMemoryPrompt,
  buildWeeklyReviewPrompt,
  buildChatPrompt,
} from './src/lib/raxxerPrompts';

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// API Health Check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', runtime: 'express' });
});

// Initialize Gemini AI SDK lazily/safely on server-side
function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is missing.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// API: Onboarding Interview Summary & Memory Generation
app.post('/api/ai/onboarding-summary', async (req, res) => {
  try {
    const { profileAnswers } = req.body;
    const ai = getGeminiClient();

    const prompt = buildOnboardingPrompt(profileAnswers || {});

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        systemInstruction: SECOND_BRAIN_SYSTEM_INSTRUCTION,
        responseMimeType: 'application/json',
        responseSchema: ONBOARDING_RESPONSE_SCHEMA as any,
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    res.json(parsed);
  } catch (error: any) {
    console.error('Error in /api/ai/onboarding-summary:', error);
    res.status(500).json({ error: error.message || 'Erro ao processar resumo do onboarding' });
  }
});

// API: "Qual é a coisa mais importante que preciso fazer hoje?"
app.post('/api/ai/priorities', async (req, res) => {
  try {
    const { profile, tasks, goals, memories } = req.body;
    const ai = getGeminiClient();

    const prompt = buildPrioritiesPrompt({ profile, tasks, goals, memories });

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        systemInstruction: SECOND_BRAIN_SYSTEM_INSTRUCTION,
      },
    });

    res.json({ answer: response.text });
  } catch (error: any) {
    console.error('Error in /api/ai/priorities:', error);
    res.status(500).json({ error: error.message || 'Erro ao gerar prioridade do dia' });
  }
});

// API: Auto-extract memory from user input
app.post('/api/ai/extract-memory', async (req, res) => {
  try {
    const { inputStatement } = req.body;
    const ai = getGeminiClient();

    const prompt = buildExtractMemoryPrompt(inputStatement || '');

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        systemInstruction: SECOND_BRAIN_SYSTEM_INSTRUCTION,
        responseMimeType: 'application/json',
        responseSchema: EXTRACT_MEMORY_RESPONSE_SCHEMA as any,
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    res.json(parsed);
  } catch (error: any) {
    console.error('Error in /api/ai/extract-memory:', error);
    res.status(500).json({ error: error.message || 'Erro ao extrair memória' });
  }
});

// API: Weekly Review Generator
app.post('/api/ai/weekly-review', async (req, res) => {
  try {
    const { completedTasks, pendingTasks, goals, memories, weekName } = req.body;
    const ai = getGeminiClient();

    const prompt = buildWeeklyReviewPrompt({
      completedTasks,
      pendingTasks,
      goals,
      memories,
      weekName,
    });

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        systemInstruction: SECOND_BRAIN_SYSTEM_INSTRUCTION,
        responseMimeType: 'application/json',
        responseSchema: WEEKLY_REVIEW_RESPONSE_SCHEMA as any,
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    res.json(parsed);
  } catch (error: any) {
    console.error('Error in /api/ai/weekly-review:', error);
    res.status(500).json({ error: error.message || 'Erro ao gerar revisão semanal' });
  }
});

// API: General AI Chat Advisor
app.post('/api/ai/chat', async (req, res) => {
  try {
    const body = req.body || {};
    const message = body.message;
    const context = body.context || {};
    const profile = body.profile || context.profile;
    const memories = body.memories || context.memories;
    const goals = body.goals || context.goals;
    let tasks = body.tasks || context.tasks;
    if (!tasks && body.systemContext) {
      try {
        const parsed = JSON.parse(body.systemContext);
        tasks = parsed.tasks;
      } catch {}
    }
    const dailyHistory = body.dailyHistory || context.dailyHistory;
    const chatHistory = body.chatHistory || context.chatHistory;

    const ai = getGeminiClient();

    const contextPrompt = buildChatPrompt({
      message,
      profile,
      memories,
      goals,
      tasks,
      dailyHistory,
      chatHistory,
    });

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: contextPrompt,
      config: {
        systemInstruction: SECOND_BRAIN_SYSTEM_INSTRUCTION,
        responseMimeType: 'application/json',
        responseSchema: CHAT_RESPONSE_SCHEMA as any,
      },
    });

    let text = response.text || '';
    let actions: any[] = [];

    try {
      const parsed = JSON.parse(response.text || '{}');
      if (parsed.text) text = parsed.text;
      if (Array.isArray(parsed.actions)) actions = parsed.actions;
    } catch (e) {
      // Fallback
    }

    res.json({ text, actions });
  } catch (error: any) {
    console.error('Error in /api/ai/chat:', error);
    res.status(500).json({ error: error.message || 'Erro na resposta da IA' });
  }
});

// Vite & Express Integration
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`RAXXER Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
