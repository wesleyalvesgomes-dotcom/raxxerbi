import {
  callGeminiREST,
  buildChatPrompt,
  buildOnboardingPrompt,
  buildPrioritiesPrompt,
  buildExtractMemoryPrompt,
  buildWeeklyReviewPrompt,
  CHAT_RESPONSE_SCHEMA,
  ONBOARDING_RESPONSE_SCHEMA,
  EXTRACT_MEMORY_RESPONSE_SCHEMA,
  WEEKLY_REVIEW_RESPONSE_SCHEMA,
} from './lib/raxxerPrompts';

interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  run(): Promise<unknown>;
}

interface D1Database {
  prepare(query: string): D1Statement;
}

interface AccessClaims {
  sub?: string;
  email?: string;
  name?: string;
  aud?: string | string[];
  iss?: string;
  exp?: number;
  nbf?: number;
}

interface AccessJwkSet {
  keys: JsonWebKey[];
}

export interface Env {
  GEMINI_API_KEY?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  DB?: D1Database;
  ASSETS?: {
    fetch: (request: Request) => Promise<Response>;
  };
}

interface AuthenticatedUser {
  id: string;
  email: string;
  name: string | null;
}

const MAX_REQUEST_BYTES = 64 * 1024;
let jwksCache: { expiresAt: number; keys: JsonWebKey[] } | undefined;

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeJwtPart<T>(value: string): T {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as T;
}

async function getAccessKeys(domain: string): Promise<JsonWebKey[]> {
  if (jwksCache && jwksCache.expiresAt > Date.now()) return jwksCache.keys;

  const response = await fetch(`https://${domain}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error('Não foi possível validar as chaves do Cloudflare Access.');

  const data = (await response.json()) as AccessJwkSet;
  if (!Array.isArray(data.keys) || data.keys.length === 0) {
    throw new Error('O endpoint de chaves do Cloudflare Access retornou dados inválidos.');
  }

  jwksCache = { keys: data.keys, expiresAt: Date.now() + 5 * 60 * 1000 };
  return data.keys;
}

async function verifyAccessIdentity(request: Request, env: Env): Promise<AuthenticatedUser | null> {
  const domain = env.ACCESS_TEAM_DOMAIN?.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  const expectedAudience = env.ACCESS_AUD?.trim();
  if (!domain || !expectedAudience) {
    throw new Error('A autenticação do Cloudflare Access ainda não foi configurada.');
  }

  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const header = decodeJwtPart<{ alg?: string; kid?: string }>(parts[0]);
    const claims = decodeJwtPart<AccessClaims>(parts[1]);
    if (header.alg !== 'RS256' || !header.kid) return null;

    const issuer = `https://${domain}`;
    const now = Math.floor(Date.now() / 1000);
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (
      claims.iss !== issuer ||
      !audiences.includes(expectedAudience) ||
      typeof claims.exp !== 'number' ||
      claims.exp <= now ||
      (typeof claims.nbf === 'number' && claims.nbf > now) ||
      !claims.sub ||
      !claims.email
    ) {
      return null;
    }

    const keys = await getAccessKeys(domain);
    const jwk = keys.find((key) => (key as JsonWebKey & { kid?: string }).kid === header.kid);
    if (!jwk) return null;

    const publicKey = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      publicKey,
      decodeBase64Url(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    );
    if (!valid) return null;

    return { id: claims.sub, email: claims.email, name: claims.name || null };
  } catch {
    return null;
  }
}

async function persistAuthenticatedUser(db: D1Database, user: AuthenticatedUser): Promise<void> {
  await db.prepare(
    `INSERT INTO users (id, email, display_name, updated_at)
     VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     ON CONFLICT(id) DO UPDATE SET
       email = excluded.email,
       display_name = excluded.display_name,
       updated_at = excluded.updated_at
     WHERE users.disabled_at IS NULL`
  ).bind(user.id, user.email.toLowerCase(), user.name).run();
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      if (url.pathname === '/api/health') {
        return jsonResponse({ status: 'ok', runtime: 'cloudflare-worker' });
      }

      // Every API route other than health requires a cryptographically verified Access JWT.
      let user: AuthenticatedUser | null;
      try {
        user = await verifyAccessIdentity(request, env);
      } catch {
        return jsonResponse({
          error: 'A autenticação ainda não está configurada no Cloudflare Worker.',
          code: 'AUTH_NOT_CONFIGURED',
        }, 503);
      }
      if (!user) {
        return jsonResponse({ error: 'Autenticação obrigatória.', code: 'UNAUTHENTICATED' }, 401);
      }
      if (!env.DB) {
        return jsonResponse({ error: 'O banco D1 não está configurado.', code: 'DATABASE_NOT_CONFIGURED' }, 503);
      }

      try {
        await persistAuthenticatedUser(env.DB, user);
      } catch (error) {
        console.error('Falha ao registrar identidade autenticada no D1:', error);
        return jsonResponse({ error: 'Não foi possível confirmar a identidade no banco de dados.' }, 503);
      }

      if (url.pathname === '/api/me') {
        if (request.method !== 'GET') {
          return jsonResponse({ error: 'Método não permitido. Utilize GET.' }, 405);
        }
        return jsonResponse({ user: { id: user.id, email: user.email, name: user.name } });
      }

      if (request.method !== 'POST') {
        return jsonResponse({ error: 'Método não permitido. Utilize POST.' }, 405);
      }

      const contentLength = Number(request.headers.get('Content-Length') || '0');
      if (contentLength > MAX_REQUEST_BYTES) {
        return jsonResponse({ error: 'A requisição excede o limite de 64 KB.' }, 413);
      }

      if (!env.GEMINI_API_KEY) {
        return jsonResponse({
          error: 'A variável/secret GEMINI_API_KEY não foi configurada no Cloudflare Worker.',
        }, 503);
      }

      let body: any;
      try {
        const rawBody = await request.text();
        if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
          return jsonResponse({ error: 'A requisição excede o limite de 64 KB.' }, 413);
        }
        body = JSON.parse(rawBody || '{}');
      } catch {
        return jsonResponse({ error: 'O corpo da requisição deve ser JSON válido.' }, 400);
      }

      const apiKey = env.GEMINI_API_KEY;
      try {
        if (url.pathname === '/api/ai/chat') {
          const message = body.message;
          const context = body.context || {};
          const profile = body.profile || context.profile;
          const memories = body.memories || context.memories;
          const goals = body.goals || context.goals;
          let tasks = body.tasks || context.tasks;
          if (!tasks && body.systemContext) {
            try {
              tasks = JSON.parse(body.systemContext).tasks;
            } catch {
              // Campo de contexto legado inválido: segue sem tarefas desse campo.
            }
          }
          const dailyHistory = body.dailyHistory || context.dailyHistory;
          const chatHistory = body.chatHistory || context.chatHistory;
          if (!message || typeof message !== 'string' || message.length > 12000) {
            return jsonResponse({ error: 'O campo "message" é obrigatório e deve ter até 12.000 caracteres.' }, 400);
          }

          const prompt = buildChatPrompt({ message, profile, memories, goals, tasks, dailyHistory, chatHistory });
          const rawResponse = await callGeminiREST({
            apiKey,
            prompt,
            responseMimeType: 'application/json',
            responseSchema: CHAT_RESPONSE_SCHEMA,
          });
          let text = rawResponse;
          let actions: unknown[] = [];
          try {
            const parsed = JSON.parse(rawResponse);
            if (parsed.text) text = parsed.text;
            if (Array.isArray(parsed.actions)) actions = parsed.actions;
          } catch {
            // Se não for JSON estrito, o texto bruto é mantido.
          }
          return jsonResponse({ text, actions });
        }

        if (url.pathname === '/api/ai/onboarding-summary') {
          const prompt = buildOnboardingPrompt(body.profileAnswers || {});
          const rawResponse = await callGeminiREST({
            apiKey, prompt, responseMimeType: 'application/json',
            responseSchema: ONBOARDING_RESPONSE_SCHEMA,
          });
          return jsonResponse(JSON.parse(rawResponse || '{}'));
        }

        if (url.pathname === '/api/ai/priorities') {
          const { profile, tasks, goals, memories } = body;
          const prompt = buildPrioritiesPrompt({ profile, tasks, goals, memories });
          const rawResponse = await callGeminiREST({ apiKey, prompt });
          return jsonResponse({ answer: rawResponse });
        }

        if (url.pathname === '/api/ai/extract-memory') {
          const prompt = buildExtractMemoryPrompt(
            typeof body.inputStatement === 'string' ? body.inputStatement.slice(0, 12000) : ''
          );
          const rawResponse = await callGeminiREST({
            apiKey, prompt, responseMimeType: 'application/json',
            responseSchema: EXTRACT_MEMORY_RESPONSE_SCHEMA,
          });
          return jsonResponse(JSON.parse(rawResponse || '{}'));
        }

        if (url.pathname === '/api/ai/weekly-review') {
          const { completedTasks, pendingTasks, goals, memories, weekName } = body;
          const prompt = buildWeeklyReviewPrompt({ completedTasks, pendingTasks, goals, memories, weekName });
          const rawResponse = await callGeminiREST({
            apiKey, prompt, responseMimeType: 'application/json',
            responseSchema: WEEKLY_REVIEW_RESPONSE_SCHEMA,
          });
          return jsonResponse(JSON.parse(rawResponse || '{}'));
        }

        return jsonResponse({ error: 'Endpoint não encontrado.' }, 404);
      } catch (error) {
        console.error('Erro no Worker RAXXER:', error);
        return jsonResponse({ error: 'Erro ao processar a solicitação de IA.' }, 500);
      }
    }

    if (env.ASSETS) {
      const response = await env.ASSETS.fetch(request);
      if (response.status === 404 && request.method === 'GET' && !url.pathname.includes('.')) {
        return env.ASSETS.fetch(new Request(new URL('/', request.url).toString(), request));
      }
      return response;
    }

    return new Response('Not found', { status: 404 });
  },
};
