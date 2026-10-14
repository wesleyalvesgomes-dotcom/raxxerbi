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


test('valid Access identity scopes D1 collection reads to the verified subject', async () => {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  ) as CryptoKeyPair;
  const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey) as JsonWebKey & { kid: string };
  publicJwk.kid = 'raxxer-test-key';

  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'RS256', typ: 'JWT', kid: publicJwk.kid });
  const claims = encode({
    iss: 'https://example.cloudflareaccess.com',
    aud: ['expected-audience'],
    sub: 'user-verified-123',
    email: 'wesley@example.com',
    exp: Math.floor(Date.now() / 1000) + 300,
  });
  const unsignedToken = header + '.' + claims;
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    keyPair.privateKey,
    new TextEncoder().encode(unsignedToken)
  );
  const token = unsignedToken + '.' + Buffer.from(signature).toString('base64url');

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ keys: [publicJwk] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  const queryCalls: Array<{ sql: string; values: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement: any = {
        bind(...bound: unknown[]) {
          values = bound;
          return statement;
        },
        async first() {
          queryCalls.push({ sql, values });
          if (sql.includes('INSERT INTO users')) return { id: values[0] };
          return null;
        },
        async all() {
          queryCalls.push({ sql, values });
          return { results: [] };
        },
        async run() {
          queryCalls.push({ sql, values });
          return {};
        },
      };
      return statement;
    },
  };

  try {
    const response = await worker.fetch(
      new Request('https://raxxer.example/api/data/tasks?user_id=attacker-controlled', {
        headers: { 'Cf-Access-Jwt-Assertion': token },
      }),
      {
        ACCESS_TEAM_DOMAIN: 'example.cloudflareaccess.com',
        ACCESS_AUD: 'expected-audience',
        DB: db,
      } as any
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { collection: 'tasks', items: [] });
    const collectionQuery = queryCalls.find((call) => call.sql.includes('SELECT item_id, data_json'));
    assert.ok(collectionQuery);
    assert.deepEqual(collectionQuery.values, ['user-verified-123', 'tasks']);
    assert.ok(!collectionQuery.values.includes('attacker-controlled'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
