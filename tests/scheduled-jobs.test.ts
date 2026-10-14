import test from 'node:test';
import assert from 'node:assert/strict';
import { processDueJobs } from '../src/worker';

test('scheduled jobs create a deterministic summary from existing records and complete', async () => {
  const job = {
    id: 'job-test-1',
    user_id: 'user-test-1',
    job_type: 'daily_briefing' as const,
    payload_json: '{}',
    status: 'pending',
    run_at: '2026-10-14T10:00:00.000Z',
    attempt_count: 0,
    idempotency_key: 'daily-briefing-test',
    recurrence: 'once' as const,
  };
  const calls: Array<{ sql: string; values: unknown[] }> = [];

  const db = {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement: any = {
        bind(...bound: unknown[]) {
          values = bound;
          return statement;
        },
        async all() {
          calls.push({ sql, values });
          if (sql.includes('FROM scheduled_jobs')) return { results: [job] };
          return { results: [] };
        },
        async first() {
          calls.push({ sql, values });
          if (sql.includes('UPDATE scheduled_jobs') && sql.includes('RETURNING')) {
            return { ...job, status: 'running', attempt_count: 1 };
          }
          return null;
        },
        async run() {
          calls.push({ sql, values });
          return { meta: { changes: 1 } };
        },
      };
      return statement;
    },
  };

  const result = await processDueJobs(db as any, new Date('2026-10-14T12:00:00.000Z'));
  assert.deepEqual(result, { completed: 1, retried: 0, failed: 0 });
  assert.ok(calls.some((call) => call.sql.includes("VALUES (?, 'scheduled_outputs', ?, ?")));
  assert.ok(calls.some((call) => call.sql.includes("SET status = 'completed'")));
  const outputWrite = calls.find((call) => call.sql.includes("VALUES (?, 'scheduled_outputs', ?, ?, strftime"));
  assert.ok(outputWrite);
  const output = JSON.parse(String(outputWrite.values[2]));
  assert.equal(output.jobId, 'job-test-1');
  assert.match(output.summary, /baseado somente nos registros existentes/);
  assert.deepEqual(output.stats, { openTasks: 0, dueToday: 0, overdueTasks: 0, activeGoals: 0 });
});

test('scheduled job runner never accepts an arbitrary job type', async () => {
  const job = {
    id: 'job-test-2',
    user_id: 'user-test-1',
    job_type: 'arbitrary_code' as any,
    payload_json: '{}',
    status: 'pending',
    run_at: '2026-10-14T10:00:00.000Z',
    attempt_count: 2,
    idempotency_key: 'invalid-job',
    recurrence: 'once' as const,
  };
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement: any = {
        bind(...bound: unknown[]) { values = bound; return statement; },
        async all() {
          calls.push({ sql, values });
          if (sql.includes('FROM scheduled_jobs')) return { results: [job] };
          return { results: [] };
        },
        async first() {
          calls.push({ sql, values });
          if (sql.includes('UPDATE scheduled_jobs') && sql.includes('RETURNING')) {
            return { ...job, status: 'running', attempt_count: 3 };
          }
          return null;
        },
        async run() { calls.push({ sql, values }); return { meta: { changes: 1 } }; },
      };
      return statement;
    },
  };
  const result = await processDueJobs(db as any, new Date('2026-10-14T12:00:00.000Z'));
  assert.deepEqual(result, { completed: 0, retried: 0, failed: 1 });
  assert.ok(calls.some((call) => call.sql.includes("SET status = 'failed'")));
  assert.ok(!calls.some((call) => call.sql.includes("VALUES (?, 'scheduled_outputs', ?, ?, strftime")));
});
