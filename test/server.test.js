const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { createApp } = require('../server');

const games = [{ id: 'test-game', title: 'Test Game' }];
const database = new DatabaseSync(':memory:');
const server = createApp({ database, games }).listen(0);
let baseUrl;

before(async () => {
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  database.close();
});

test('submits scores and returns them in leaderboard order', async () => {
  const first = await fetch(`${baseUrl}/api/scores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'test-game', playerName: 'Ada', score: 40 }),
  });
  assert.equal(first.status, 201);
  assert.equal((await first.json()).playerName, 'Ada');

  const second = await fetch(`${baseUrl}/api/scores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'test-game', playerName: 'Lin', score: 90 }),
  });
  assert.equal(second.status, 201);

  const leaderboard = await fetch(`${baseUrl}/api/leaderboard/test-game`);
  assert.deepEqual((await leaderboard.json()).map(({ rank, playerName, score }) => ({ rank, playerName, score })), [
    { rank: 1, playerName: 'Lin', score: 90 },
    { rank: 2, playerName: 'Ada', score: 40 },
  ]);
});

test('keeps one best score per game and player name', async () => {
  const retryDatabase = new DatabaseSync(':memory:');
  const retryServer = createApp({ database: retryDatabase, games }).listen(0);

  try {
    await new Promise((resolve) => retryServer.once('listening', resolve));
    const url = `http://127.0.0.1:${retryServer.address().port}/api/scores`;
    const submit = async (playerName, score) => {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId: 'test-game', playerName, score }),
      });
      assert.equal(response.status, 201);
      return response.json();
    };

    assert.equal((await submit('Ada', 1000)).score, 1000);
    assert.equal((await submit(' Ada ', 0)).score, 1000);

    const afterResetAttempt = await fetch(`http://127.0.0.1:${retryServer.address().port}/api/leaderboard/test-game`);
    assert.equal((await afterResetAttempt.json())[0].score, 1000);

    assert.equal((await submit('Ada', 1200)).score, 1200);

    const leaderboard = await fetch(`http://127.0.0.1:${retryServer.address().port}/api/leaderboard/test-game`);
    assert.deepEqual((await leaderboard.json()).map(({ playerName, score }) => ({ playerName, score })), [
      { playerName: 'Ada', score: 1200 },
    ]);
  } finally {
    await new Promise((resolve, reject) => retryServer.close((error) => error ? reject(error) : resolve()));
    retryDatabase.close();
  }
});

test('deduplicates existing score rows by keeping each player\'s highest score', async () => {
  const migrationDatabase = new DatabaseSync(':memory:');
  migrationDatabase.exec(`
    CREATE TABLE scores (
      id INTEGER PRIMARY KEY,
      game_id TEXT NOT NULL,
      player_name TEXT NOT NULL,
      score INTEGER NOT NULL CHECK (score >= 0),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    INSERT INTO scores (id, game_id, player_name, score, created_at) VALUES
      (1, 'test-game', 'Ada', 40, '2026-01-01T00:00:00.000Z'),
      (2, 'test-game', 'Ada', 90, '2026-01-02T00:00:00.000Z'),
      (3, 'test-game', 'Lin', 70, '2026-01-03T00:00:00.000Z');
  `);
  const migrationServer = createApp({ database: migrationDatabase, games }).listen(0);

  try {
    await new Promise((resolve) => migrationServer.once('listening', resolve));
    const leaderboard = await fetch(`http://127.0.0.1:${migrationServer.address().port}/api/leaderboard/test-game`);
    assert.deepEqual((await leaderboard.json()).map(({ playerName, score }) => ({ playerName, score })), [
      { playerName: 'Ada', score: 90 },
      { playerName: 'Lin', score: 70 },
    ]);
  } finally {
    await new Promise((resolve, reject) => migrationServer.close((error) => error ? reject(error) : resolve()));
    migrationDatabase.close();
  }
});

test('rejects invalid scores and unknown games', async () => {
  const invalidScore = await fetch(`${baseUrl}/api/scores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'test-game', score: 2.5 }),
  });
  assert.equal(invalidScore.status, 400);

  const unknownGame = await fetch(`${baseUrl}/api/leaderboard/not-registered`);
  assert.equal(unknownGame.status, 404);
});

test('rate limits repeated score submissions from one client', async () => {
  const limitedDatabase = new DatabaseSync(':memory:');
  const limitedServer = createApp({ database: limitedDatabase, games }).listen(0);

  try {
    await new Promise((resolve) => limitedServer.once('listening', resolve));
    const url = `http://127.0.0.1:${limitedServer.address().port}/api/scores`;
    let response;
    for (let attempt = 0; attempt < 11; attempt++) {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId: 'test-game', score: 1 }),
      });
    }

    assert.equal(response.status, 429);
    assert.ok(Number(response.headers.get('retry-after')) > 0);
  } finally {
    await new Promise((resolve, reject) => limitedServer.close((error) => error ? reject(error) : resolve()));
    limitedDatabase.close();
  }
});

test('allows unlimited same-name Quick Tap retries but cools down new names', async () => {
  const quickTapDatabase = new DatabaseSync(':memory:');
  const quickTapServer = createApp({
    database: quickTapDatabase,
    games: [{ id: 'quick-tap' }, { id: 'typer' }],
  }).listen(0);

  try {
    await new Promise((resolve) => quickTapServer.once('listening', resolve));
    const url = `http://127.0.0.1:${quickTapServer.address().port}/api/scores`;
    const submit = (gameId, playerName, score) => fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId, playerName, score }),
    });

    assert.equal((await submit('quick-tap', 'Ada', 10)).status, 201);
    const sameNameRetry = await submit('quick-tap', ' Ada ', 20);
    assert.equal(sameNameRetry.status, 201);
    assert.equal((await sameNameRetry.json()).score, 20);

    for (let retry = 0; retry < 10; retry++) {
      assert.equal((await submit('quick-tap', 'Ada', 20)).status, 201);
    }

    const differentName = await submit('quick-tap', 'Lin', 10);
    assert.equal(differentName.status, 429);
    assert.ok(Number(differentName.headers.get('retry-after')) > 0);
    assert.equal((await submit('typer', 'Ada', 10)).status, 201);
  } finally {
    await new Promise((resolve, reject) => quickTapServer.close((error) => error ? reject(error) : resolve()));
    quickTapDatabase.close();
  }
});

test('registers client IP sessions, extends their time, and blocks expired clients', async () => {
  const sessionDatabase = new DatabaseSync(':memory:');
  const clientIp = '192.168.1.34';
  const sessionServer = createApp({ database: sessionDatabase, games, resolveClientIp: () => clientIp }).listen(0);

  try {
    await new Promise((resolve) => sessionServer.once('listening', resolve));
    const baseUrl = `http://127.0.0.1:${sessionServer.address().port}`;
    const getSession = () => fetch(`${baseUrl}/api/session`).then((response) => response.json());

    assert.equal((await fetch(baseUrl)).status, 200);
    assert.equal((await getSession()).registered, false);
    assert.equal((await fetch(`${baseUrl}/api/games`)).status, 403);
    assert.equal((await fetch(`${baseUrl}/games/quick-tap/index.html`)).status, 403);

    const deniedGrant = await fetch(`${baseUrl}/api/admin/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://example.test' },
      body: JSON.stringify({ ip: clientIp, minutes: 10 }),
    });
    assert.equal(deniedGrant.status, 403);

    const grant = await fetch(`${baseUrl}/api/admin/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: baseUrl },
      body: JSON.stringify({ ip: clientIp, minutes: 10 }),
    });
    assert.equal(grant.status, 201);
    const firstSession = await grant.json();
    assert.ok(firstSession.remainingMs > 9 * 60_000);
    assert.equal((await getSession()).active, true);
    assert.equal((await fetch(`${baseUrl}/api/games`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/games/quick-tap/index.html`)).status, 200);

    const extension = await fetch(`${baseUrl}/api/admin/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: baseUrl },
      body: JSON.stringify({ ip: clientIp, minutes: 5 }),
    });
    assert.equal(extension.status, 201);
    const extendedSession = await extension.json();
    assert.ok(extendedSession.expiresAt >= firstSession.expiresAt + 5 * 60_000 - 1000);

    const listedSessions = await fetch(`${baseUrl}/api/admin/sessions`);
    assert.equal((await listedSessions.json()).length, 1);

    sessionDatabase.prepare('UPDATE client_sessions SET expires_at = ? WHERE client_ip = ?').run(Date.now() - 1, clientIp);
    assert.equal((await getSession()).active, false);
    assert.equal((await fetch(`${baseUrl}/api/games`)).status, 403);
    assert.equal((await fetch(`${baseUrl}/games/quick-tap/index.html`)).status, 403);
    const expiredScore = await fetch(`${baseUrl}/api/scores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: 'test-game', playerName: 'Ada', score: 100 }),
    });
    assert.equal(expiredScore.status, 403);
    assert.equal((await fetch(baseUrl)).status, 200);
  } finally {
    await new Promise((resolve, reject) => sessionServer.close((error) => error ? reject(error) : resolve()));
    sessionDatabase.close();
  }
});

test('allows same-origin admins to revoke a client IP session', async () => {
  const revokeDatabase = new DatabaseSync(':memory:');
  const clientIp = '192.168.1.45';
  const revokeServer = createApp({ database: revokeDatabase, games, resolveClientIp: () => clientIp }).listen(0);

  try {
    await new Promise((resolve) => revokeServer.once('listening', resolve));
    const baseUrl = `http://127.0.0.1:${revokeServer.address().port}`;
    const grant = await fetch(`${baseUrl}/api/admin/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: baseUrl },
      body: JSON.stringify({ ip: clientIp, minutes: 10 }),
    });
    assert.equal(grant.status, 201);
    assert.equal((await fetch(`${baseUrl}/api/games`)).status, 200);

    const deniedRemoval = await fetch(`${baseUrl}/api/admin/sessions`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Origin: 'http://example.test' },
      body: JSON.stringify({ ip: clientIp }),
    });
    assert.equal(deniedRemoval.status, 403);

    const removed = await fetch(`${baseUrl}/api/admin/sessions`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Origin: baseUrl },
      body: JSON.stringify({ ip: clientIp }),
    });
    assert.equal(removed.status, 204);
    assert.equal((await (await fetch(`${baseUrl}/api/session`)).json()).registered, false);
    assert.equal((await fetch(`${baseUrl}/api/games`)).status, 403);
    assert.deepEqual(await (await fetch(`${baseUrl}/api/admin/sessions`)).json(), []);
  } finally {
    await new Promise((resolve, reject) => revokeServer.close((error) => error ? reject(error) : resolve()));
    revokeDatabase.close();
  }
});

test('local admin lists and removes score entries', async () => {
  const adminDatabase = new DatabaseSync(':memory:');
  const adminServer = createApp({ database: adminDatabase, games }).listen(0);

  try {
    await new Promise((resolve) => adminServer.once('listening', resolve));
    const adminUrl = `http://127.0.0.1:${adminServer.address().port}`;
    const submitted = await fetch(`${adminUrl}/api/scores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: 'test-game', playerName: 'Ada', score: 40 }),
    });
    const score = await submitted.json();

    const entriesResponse = await fetch(`${adminUrl}/api/admin/scores`);
    assert.equal(entriesResponse.status, 200);
    assert.equal((await entriesResponse.json())[0].id, score.id);

    const deniedDelete = await fetch(`${adminUrl}/api/admin/scores/${score.id}`, {
      method: 'DELETE',
      headers: { Origin: 'http://example.test' },
    });
    assert.equal(deniedDelete.status, 403);

    const removed = await fetch(`${adminUrl}/api/admin/scores/${score.id}`, {
      method: 'DELETE',
      headers: { Origin: adminUrl },
    });
    assert.equal(removed.status, 204);

    const adminPage = await fetch(`${adminUrl}/admin`);
    assert.equal(adminPage.status, 200);
    assert.match(await adminPage.text(), /Score entries/);
    assert.deepEqual(await (await fetch(`${adminUrl}/api/admin/scores`)).json(), []);
  } finally {
    await new Promise((resolve, reject) => adminServer.close((error) => error ? reject(error) : resolve()));
    adminDatabase.close();
  }
});