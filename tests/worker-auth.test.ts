import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker';

const assets = {
  fetch: async () => new Response('frontend', { status: 200 }),
};

test('health endpoint remains available without authentication', async () => {
  const response = await worker.fetch(
    new Request('https://raxxer.example/api/health'),
    { ASSETS: assets }
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok', runtime: 'cloudflare-worker' });
});

test('protected API fails closed when Access configuration is missing', async () => {
  const response = await worker.fetch(
    new Request('https://raxxer.example/api/me'),
    { DB: { prepare: () => { throw new Error('Database must not be reached'); } } }
  );
  assert.equal(response.status, 503);
  assert.equal((await response.json() as { code: string }).code, 'AUTH_NOT_CONFIGURED');
});

test('protected API rejects requests without an Access JWT', async () => {
  const response = await worker.fetch(
    new Request('https://raxxer.example/api/me'),
    {
      ACCESS_TEAM_DOMAIN: 'example.cloudflareaccess.com',
      ACCESS_AUD: 'expected-audience',
      DB: { prepare: () => { throw new Error('Unauthenticated requests must not reach D1'); } },
    }
  );
  assert.equal(response.status, 401);
  assert.equal((await response.json() as { code: string }).code, 'UNAUTHENTICATED');
});

test('protected API rejects malformed Access JWTs before touching D1', async () => {
  const response = await worker.fetch(
    new Request('https://raxxer.example/api/me', {
      headers: { 'Cf-Access-Jwt-Assertion': 'not-a-jwt' },
    }),
    {
      ACCESS_TEAM_DOMAIN: 'example.cloudflareaccess.com',
      ACCESS_AUD: 'expected-audience',
      DB: { prepare: () => { throw new Error('Invalid JWT must not reach D1'); } },
    }
  );
  assert.equal(response.status, 401);
  assert.equal((await response.json() as { code: string }).code, 'UNAUTHENTICATED');
});


test('D1 collection endpoints reject unauthenticated access', async () => {
  const response = await worker.fetch(
    new Request('https://raxxer.example/api/data/tasks'),
    {
      ACCESS_TEAM_DOMAIN: 'example.cloudflareaccess.com',
      ACCESS_AUD: 'expected-audience',
      DB: { prepare: () => { throw new Error('Unauthenticated data access must not reach D1'); } },
    }
  );
  assert.equal(response.status, 401);
  assert.equal((await response.json() as { code: string }).code, 'UNAUTHENTICATED');
});
