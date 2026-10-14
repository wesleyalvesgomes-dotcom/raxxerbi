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
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
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
const DATA_COLLECTIONS = new Set([
  'profile',
  'tasks',
  'goals',
  'memories',
  'projects',
  'daily_history',
  'weekly_reviews',
  'commercial_leads',
  'commercial_lead_history',
  'commercial_interactions',
  'commercial_visits',
  'commercial_proposals',
  'commercial_sales',
  'commercial_goals',
  'scheduled_outputs',
]);
let jwksCache: { domain: string; expiresAt: number; keys: JsonWebKey[] } | undefined;

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
  if (jwksCache && jwksCache.domain === domain && jwksCache.expiresAt > Date.now()) return jwksCache.keys;

  const response = await fetch(`https://${domain}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error('Não foi possível validar as chaves do Cloudflare Access.');

  const data = (await response.json()) as AccessJwkSet;
  if (!Array.isArray(data.keys) || data.keys.length === 0) {
    throw new Error('O endpoint de chaves do Cloudflare Access retornou dados inválidos.');
  }

  jwksCache = { domain, keys: data.keys, expiresAt: Date.now() + 5 * 60 * 1000 };
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

async function persistAuthenticatedUser(db: D1Database, user: AuthenticatedUser): Promise<boolean> {
  const result = await db.prepare(
    `INSERT INTO users (id, email, display_name, updated_at)
     VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     ON CONFLICT(id) DO UPDATE SET
       email = excluded.email,
       display_name = excluded.display_name,
       updated_at = excluded.updated_at
     WHERE users.disabled_at IS NULL
     RETURNING id`
  ).bind(user.id, user.email.toLowerCase(), user.name).first<{ id: string }>();
  return Boolean(result?.id);
}



type ScheduledJob = {
  id: string;
  user_id: string;
  job_type: 'daily_briefing' | 'weekly_review';
  payload_json: string;
  status: string;
  run_at: string;
  attempt_count: number;
  idempotency_key: string;
  recurrence: 'once' | 'daily' | 'weekly';
};

function saoPauloDate(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value || '';
  return part('year') + '-' + part('month') + '-' + part('day');
}

async function readUserCollection(db: D1Database, userId: string, collection: string): Promise<any[]> {
  const rows = await db.prepare(
    'SELECT data_json FROM user_data WHERE user_id = ? AND collection = ? ORDER BY item_id ASC'
  ).bind(userId, collection).all<{ data_json: string }>();
  return rows.results.map((row) => JSON.parse(row.data_json));
}

async function createScheduledOutput(db: D1Database, job: ScheduledJob): Promise<void> {
  const [tasks, goals] = await Promise.all([
    readUserCollection(db, job.user_id, 'tasks'),
    readUserCollection(db, job.user_id, 'goals'),
  ]);
  const today = saoPauloDate();
  const activeTasks = tasks.filter((task) => task && task.status !== 'cancelada' && task.status !== 'concluida' && !task.concluida);
  const dueToday = activeTasks.filter((task) => task.data === today);
  const overdue = activeTasks.filter((task) => typeof task.data === 'string' && task.data < today);
  const activeGoals = goals.filter((goal) => goal && goal.status !== 'concluido');
  const isWeekly = job.job_type === 'weekly_review';
  const titleOf = (task: any) => typeof task?.titulo === 'string' && task.titulo.trim()
    ? task.titulo.trim().slice(0, 120)
    : 'Tarefa sem título';
  const overdueLines = overdue.slice(0, 5).map((task) => '- ' + titleOf(task) + (task.data ? ' (' + task.data + ')' : ''));
  const dueTodayLines = dueToday.slice(0, 5).map((task) => '- ' + titleOf(task));
  const openTaskLines = activeTasks.slice(0, 5).map((task) => '- ' + titleOf(task) + (task.data ? ' (' + task.data + ')' : ''));
  const lines = isWeekly
    ? [
        'Resumo baseado somente nos registros existentes no RAXXER.',
        'Tarefas em aberto: ' + activeTasks.length,
        'Tarefas com data anterior a hoje: ' + overdue.length,
        'Metas em andamento: ' + activeGoals.length,
        'Tarefas em aberto (até 5):',
        ...(openTaskLines.length ? openTaskLines : ['- Nenhuma tarefa em aberto.']),
      ]
    : [
        'Resumo baseado somente nos registros existentes no RAXXER.',
        'Tarefas previstas para hoje ainda abertas: ' + dueToday.length,
        ...(dueTodayLines.length ? ['Tarefas de hoje (até 5):', ...dueTodayLines] : ['Nenhuma tarefa pendente com data de hoje.']),
        'Tarefas com data anterior a hoje ainda abertas: ' + overdue.length,
        ...(overdueLines.length ? ['Tarefas atrasadas (até 5):', ...overdueLines] : []),
        'Metas em andamento: ' + activeGoals.length,
      ];
  const outputId = job.recurrence === 'once' ? job.id : job.id + '-' + today;
  const output = {
    id: outputId,
    jobId: job.id,
    type: job.job_type,
    title: isWeekly ? 'Revisão semanal automática' : 'Resumo diário automático',
    createdAt: new Date().toISOString(),
    date: today,
    summary: lines.join('\n'),
    stats: { openTasks: activeTasks.length, dueToday: dueToday.length, overdueTasks: overdue.length, activeGoals: activeGoals.length },
    source: 'scheduled_job',
  };
  await db.prepare(
    `INSERT INTO user_data (user_id, collection, item_id, data_json, updated_at)
     VALUES (?, 'scheduled_outputs', ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     ON CONFLICT(user_id, collection, item_id) DO UPDATE SET
       data_json = excluded.data_json, updated_at = excluded.updated_at`
  ).bind(job.user_id, outputId, JSON.stringify(output)).run();
}

export async function processDueJobs(db: D1Database, now = new Date()): Promise<{ completed: number; retried: number; failed: number }> {
  const nowIso = now.toISOString();
  const staleBefore = new Date(now.getTime() - 15 * 60 * 1000).toISOString();
  const due = await db.prepare(
    `SELECT id, user_id, job_type, payload_json, status, run_at, attempt_count, idempotency_key, recurrence
     FROM scheduled_jobs
     WHERE (status = 'pending' AND run_at <= ?)
        OR (status = 'running' AND updated_at <= ?)
     ORDER BY run_at ASC LIMIT 25`
  ).bind(nowIso, staleBefore).all<ScheduledJob>();
  const stats = { completed: 0, retried: 0, failed: 0 };

  for (const candidate of due.results) {
    const claimed = await db.prepare(
      `UPDATE scheduled_jobs
       SET status = 'running', attempt_count = attempt_count + 1,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND ((status = 'pending' AND run_at <= ?) OR (status = 'running' AND updated_at <= ?))
       RETURNING id, user_id, job_type, payload_json, status, run_at, attempt_count, idempotency_key, recurrence`
    ).bind(candidate.id, nowIso, staleBefore).first<ScheduledJob>();
    if (!claimed) continue;

    try {
      if (claimed.job_type !== 'daily_briefing' && claimed.job_type !== 'weekly_review') {
        throw new Error('Tipo de trabalho não permitido.');
      }
      await createScheduledOutput(db, claimed);
      if (claimed.recurrence === 'daily' || claimed.recurrence === 'weekly') {
        const interval = claimed.recurrence === 'daily' ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
        const nextRunAt = new Date(now.getTime() + interval).toISOString();
        await db.prepare(
          `UPDATE scheduled_jobs SET status = 'pending', run_at = ?, attempt_count = 0, last_error = NULL,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND status = 'running'`
        ).bind(nextRunAt, claimed.id).run();
      } else {
        await db.prepare(
          `UPDATE scheduled_jobs SET status = 'completed', last_error = NULL,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND status = 'running'`
        ).bind(claimed.id).run();
      }
      await db.prepare(
        `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, outcome, details_json)
         VALUES (?, ?, 'scheduled_job_executed', 'scheduled_job', ?, 'success', ?)`
      ).bind(crypto.randomUUID(), claimed.user_id, claimed.id, JSON.stringify({ type: claimed.job_type })).run();
      stats.completed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 300) : 'Erro desconhecido';
      if (claimed.attempt_count < 3) {
        const delayMinutes = claimed.attempt_count === 1 ? 1 : 5;
        const retryAt = new Date(now.getTime() + delayMinutes * 60 * 1000).toISOString();
        await db.prepare(
          `UPDATE scheduled_jobs SET status = 'pending', run_at = ?, last_error = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND status = 'running'`
        ).bind(retryAt, message, claimed.id).run();
        stats.retried += 1;
      } else {
        await db.prepare(
          `UPDATE scheduled_jobs SET status = 'failed', last_error = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND status = 'running'`
        ).bind(message, claimed.id).run();
        stats.failed += 1;
      }
      await db.prepare(
        `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, outcome, details_json)
         VALUES (?, ?, 'scheduled_job_failed', 'scheduled_job', ?, 'failure', ?)`
      ).bind(crypto.randomUUID(), claimed.user_id, claimed.id, JSON.stringify({ type: claimed.job_type, attempt: claimed.attempt_count, error: message })).run();
    }
  }
  return stats;
}

export default {
  async scheduled(_event: { scheduledTime: number; cron: string }, env: Env): Promise<void> {
    if (!env.DB) throw new Error('D1 não configurado para executar trabalhos agendados.');
    await processDueJobs(env.DB);
  },

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
        const activeUser = await persistAuthenticatedUser(env.DB, user);
        if (!activeUser) {
          return jsonResponse({ error: 'Esta conta não está autorizada a acessar o RAXXER.' }, 403);
        }
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

      if (url.pathname === '/api/jobs') {
        if (request.method === 'GET') {
          try {
            const jobs = await env.DB.prepare(
              'SELECT id, job_type, status, run_at, recurrence, attempt_count, last_error, created_at, updated_at FROM scheduled_jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT 100'
            ).bind(user.id).all();
            return jsonResponse({ jobs: jobs.results });
          } catch (error) {
            console.error('Falha ao listar trabalhos agendados:', error);
            return jsonResponse({ error: 'Não foi possível consultar os trabalhos agendados.' }, 503);
          }
        }
        if (request.method === 'POST') {
          const contentLength = Number(request.headers.get('Content-Length') || '0');
          if (contentLength > MAX_REQUEST_BYTES) return jsonResponse({ error: 'A requisição excede o limite de 64 KB.' }, 413);
          let body: any;
          try {
            const rawBody = await request.text();
            if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
              return jsonResponse({ error: 'A requisição excede o limite de 64 KB.' }, 413);
            }
            body = JSON.parse(rawBody || '{}');
          } catch { return jsonResponse({ error: 'JSON inválido.' }, 400); }
          const jobType = body?.type;
          const runAt = typeof body?.runAt === 'string' ? new Date(body.runAt) : null;
          if (body?.recurrence !== undefined && !['once', 'daily', 'weekly'].includes(body.recurrence)) {
            return jsonResponse({ error: 'Recorrência inválida. Use once, daily ou weekly.' }, 400);
          }
          const recurrence = body?.recurrence === 'daily' || body?.recurrence === 'weekly' ? body.recurrence : 'once';
          const idempotencyKey = typeof body?.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
          if (jobType !== 'daily_briefing' && jobType !== 'weekly_review') {
            return jsonResponse({ error: 'Tipo inválido. Use daily_briefing ou weekly_review.' }, 400);
          }
          if (!runAt || !Number.isFinite(runAt.getTime()) || runAt.getTime() < Date.now() + 60_000 || runAt.getTime() > Date.now() + 366 * 24 * 60 * 60 * 1000) {
            return jsonResponse({ error: 'A execução deve ser agendada entre 1 minuto e 366 dias a partir de agora.' }, 400);
          }
          if (!idempotencyKey || idempotencyKey.length > 160) {
            return jsonResponse({ error: 'Informe uma chave de idempotência de até 160 caracteres.' }, 400);
          }
          const id = crypto.randomUUID();
          try {
            const existing = await env.DB.prepare(
              'SELECT id, job_type, status, run_at, recurrence FROM scheduled_jobs WHERE user_id = ? AND idempotency_key = ?'
            ).bind(user.id, idempotencyKey).first();
            if (existing) return jsonResponse({ job: existing, reused: true });
            const pendingCount = await env.DB.prepare(
              "SELECT COUNT(*) AS count FROM scheduled_jobs WHERE user_id = ? AND status = 'pending'"
            ).bind(user.id).first<{ count: number }>();
            if ((pendingCount?.count || 0) >= 50) {
              return jsonResponse({ error: 'Limite de 50 agendamentos pendentes por usuário atingido.' }, 429);
            }
            await env.DB.prepare(
              `INSERT INTO scheduled_jobs (id, user_id, job_type, payload_json, status, run_at, idempotency_key, recurrence)
               VALUES (?, ?, ?, '{}', 'pending', ?, ?, ?)`
            ).bind(id, user.id, jobType, runAt.toISOString(), idempotencyKey, recurrence).run();
            await env.DB.prepare(
              `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, outcome, details_json)
               VALUES (?, ?, 'scheduled_job_created', 'scheduled_job', ?, 'success', ?)`
            ).bind(crypto.randomUUID(), user.id, id, JSON.stringify({ type: jobType, runAt: runAt.toISOString(), recurrence })).run();
            return jsonResponse({ job: { id, type: jobType, status: 'pending', runAt: runAt.toISOString(), recurrence } }, 201);
          } catch (error) {
            console.error('Falha ao criar trabalho agendado:', error);
            return jsonResponse({ error: 'Não foi possível agendar este trabalho.' }, 503);
          }
        }
        return jsonResponse({ error: 'Método não permitido. Utilize GET ou POST.' }, 405);
      }

      if (url.pathname.startsWith('/api/jobs/') && request.method === 'DELETE') {
        let id: string;
        try { id = decodeURIComponent(url.pathname.slice('/api/jobs/'.length)); }
        catch { return jsonResponse({ error: 'Identificador inválido.' }, 400); }
        if (!id || id.length > 200 || id.includes('/')) return jsonResponse({ error: 'Identificador inválido.' }, 400);
        try {
          const result = await env.DB.prepare(
            `UPDATE scheduled_jobs SET status = 'cancelled',
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE user_id = ? AND id = ? AND status = 'pending'`
          ).bind(user.id, id).run() as { meta?: { changes?: number } };
          if (!result.meta?.changes) return jsonResponse({ error: 'Trabalho não encontrado ou não pode mais ser cancelado.' }, 404);
          return jsonResponse({ ok: true, id });
        } catch (error) {
          console.error('Falha ao cancelar trabalho agendado:', error);
          return jsonResponse({ error: 'Não foi possível cancelar o trabalho.' }, 503);
        }
      }

      // User-scoped storage API used for gradual, non-destructive localStorage migration.
      if (url.pathname.startsWith('/api/data/')) {
        const segments = url.pathname.split('/').filter(Boolean);
        if (segments.length < 3 || segments.length > 4) {
          return jsonResponse({ error: 'Rota de dados inválida.' }, 404);
        }

        let collection: string;
        let itemId: string | undefined;
        try {
          collection = decodeURIComponent(segments[2]);
          itemId = segments[3] ? decodeURIComponent(segments[3]) : undefined;
        } catch {
          return jsonResponse({ error: 'Identificador inválido.' }, 400);
        }
        if (!DATA_COLLECTIONS.has(collection)) {
          return jsonResponse({ error: 'Coleção não permitida.' }, 404);
        }
        if (itemId !== undefined && (!itemId.trim() || itemId.length > 200)) {
          return jsonResponse({ error: 'Identificador inválido.' }, 400);
        }

        if (request.method === 'GET') {
          try {
            if (itemId !== undefined) {
              const record = await env.DB.prepare(
                'SELECT item_id, data_json, updated_at FROM user_data WHERE user_id = ? AND collection = ? AND item_id = ?'
              ).bind(user.id, collection, itemId).first<{ item_id: string; data_json: string; updated_at: string }>();
              if (!record) return jsonResponse({ error: 'Registro não encontrado.' }, 404);
              return jsonResponse({ id: record.item_id, data: JSON.parse(record.data_json), updatedAt: record.updated_at });
            }
            const records = await env.DB.prepare(
              'SELECT item_id, data_json, updated_at FROM user_data WHERE user_id = ? AND collection = ? ORDER BY updated_at DESC, item_id ASC'
            ).bind(user.id, collection).all<{ item_id: string; data_json: string; updated_at: string }>();
            return jsonResponse({
              collection,
              items: records.results.map((record) => ({
                id: record.item_id,
                data: JSON.parse(record.data_json),
                updatedAt: record.updated_at,
              })),
            });
          } catch (error) {
            console.error('Falha ao ler dados do usuário no D1:', error);
            return jsonResponse({ error: 'Não foi possível ler os dados persistidos.' }, 503);
          }
        }

        if (request.method === 'PUT' && itemId !== undefined) {
          const contentLength = Number(request.headers.get('Content-Length') || '0');
          if (contentLength > MAX_REQUEST_BYTES) {
            return jsonResponse({ error: 'A requisição excede o limite de 64 KB.' }, 413);
          }
          let recordBody: any;
          try {
            const rawBody = await request.text();
            if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
              return jsonResponse({ error: 'A requisição excede o limite de 64 KB.' }, 413);
            }
            recordBody = JSON.parse(rawBody);
          } catch {
            return jsonResponse({ error: 'O corpo da requisição deve ser JSON válido.' }, 400);
          }
          if (!recordBody || !Object.prototype.hasOwnProperty.call(recordBody, 'data')) {
            return jsonResponse({ error: 'O campo "data" é obrigatório.' }, 400);
          }
          const serialized = JSON.stringify(recordBody.data);
          if (typeof serialized !== 'string' || serialized.length > MAX_REQUEST_BYTES) {
            return jsonResponse({ error: 'O registro é inválido ou excede 64 KB.' }, 413);
          }
          const hasExpectedVersion = Object.prototype.hasOwnProperty.call(recordBody, 'expectedUpdatedAt');
          const expectedVersion = recordBody.expectedUpdatedAt;
          if (hasExpectedVersion && expectedVersion !== null && (typeof expectedVersion !== 'string' || expectedVersion.length > 100)) {
            return jsonResponse({ error: 'Versão de registro inválida.' }, 400);
          }
          try {
            let saved: { updated_at: string } | null;
            if (hasExpectedVersion && expectedVersion === null) {
              saved = await env.DB.prepare(
                `INSERT INTO user_data (user_id, collection, item_id, data_json, updated_at)
                 VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                 ON CONFLICT(user_id, collection, item_id) DO NOTHING
                 RETURNING updated_at`
              ).bind(user.id, collection, itemId, serialized).first<{ updated_at: string }>();
            } else if (hasExpectedVersion) {
              saved = await env.DB.prepare(
                `UPDATE user_data SET data_json = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 WHERE user_id = ? AND collection = ? AND item_id = ? AND updated_at = ?
                 RETURNING updated_at`
              ).bind(serialized, user.id, collection, itemId, expectedVersion).first<{ updated_at: string }>();
            } else {
              saved = await env.DB.prepare(
                `INSERT INTO user_data (user_id, collection, item_id, data_json, updated_at)
                 VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                 ON CONFLICT(user_id, collection, item_id) DO UPDATE SET
                   data_json = excluded.data_json,
                   updated_at = excluded.updated_at
                 RETURNING updated_at`
              ).bind(user.id, collection, itemId, serialized).first<{ updated_at: string }>();
            }
            if (!saved) {
              return jsonResponse({ error: 'O registro foi alterado em outro dispositivo. Seus dados locais foram preservados; sincronize novamente antes de tentar.' }, 409);
            }
            return jsonResponse({ ok: true, id: itemId, updatedAt: saved.updated_at });
          } catch (error) {
            console.error('Falha ao salvar dados do usuário no D1:', error);
            return jsonResponse({ error: 'Não foi possível salvar o registro.' }, 503);
          }
        }

        if (request.method === 'DELETE' && itemId !== undefined) {
          let expectedVersion: string | null = null;
          let hasExpectedVersion = false;
          try {
            const rawBody = await request.text();
            if (rawBody) {
              const deleteBody = JSON.parse(rawBody);
              hasExpectedVersion = Object.prototype.hasOwnProperty.call(deleteBody || {}, 'expectedUpdatedAt');
              expectedVersion = deleteBody?.expectedUpdatedAt;
              if (hasExpectedVersion && (typeof expectedVersion !== 'string' || expectedVersion.length > 100)) {
                return jsonResponse({ error: 'Versão de registro inválida.' }, 400);
              }
            }
          } catch {
            return jsonResponse({ error: 'O corpo da requisição deve ser JSON válido.' }, 400);
          }
          try {
            if (hasExpectedVersion) {
              const result = await env.DB.prepare(
                'DELETE FROM user_data WHERE user_id = ? AND collection = ? AND item_id = ? AND updated_at = ?'
              ).bind(user.id, collection, itemId, expectedVersion).run() as { meta?: { changes?: number } };
              if (!result.meta?.changes) {
                const current = await env.DB.prepare(
                  'SELECT updated_at FROM user_data WHERE user_id = ? AND collection = ? AND item_id = ?'
                ).bind(user.id, collection, itemId).first();
                if (current) return jsonResponse({ error: 'O registro foi alterado em outro dispositivo; a exclusão foi cancelada.' }, 409);
                return jsonResponse({ error: 'Registro não encontrado.' }, 404);
              }
            } else {
              await env.DB.prepare(
                'DELETE FROM user_data WHERE user_id = ? AND collection = ? AND item_id = ?'
              ).bind(user.id, collection, itemId).run();
            }
            return jsonResponse({ ok: true, id: itemId });
          } catch (error) {
            console.error('Falha ao excluir dados do usuário no D1:', error);
            return jsonResponse({ error: 'Não foi possível excluir o registro.' }, 503);
          }
        }

        return jsonResponse({
          error: itemId === undefined
            ? 'A coleção aceita apenas GET.'
            : 'Método não permitido para este registro. Utilize GET, PUT ou DELETE.',
        }, 405);
      }

      // Persistent per-user rate limit: protect Gemini quota from accidental loops and abuse.
      if (url.pathname.startsWith('/api/ai/')) {
        const windowStart = Math.floor(Date.now() / 60000);
        try {
          const rate = await env.DB.prepare(
            `INSERT INTO api_rate_limits (user_id, window_start, request_count)
             VALUES (?, ?, 1)
             ON CONFLICT(user_id) DO UPDATE SET
               request_count = CASE
                 WHEN api_rate_limits.window_start = excluded.window_start
                 THEN api_rate_limits.request_count + 1
                 ELSE 1
               END,
               window_start = excluded.window_start
             RETURNING request_count`
          ).bind(user.id, windowStart).first<{ request_count: number }>();
          if (!rate || rate.request_count > 30) {
            return jsonResponse({
              error: 'Limite temporário de uso da IA atingido. Aguarde um minuto e tente novamente.',
              code: 'AI_RATE_LIMITED',
            }, 429);
          }
        } catch (error) {
          console.error('Falha ao verificar limite de uso da IA:', error);
          return jsonResponse({ error: 'Não foi possível validar o limite de uso da IA.' }, 503);
        }
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
