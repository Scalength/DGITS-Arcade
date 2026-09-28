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

test('applies a per-client cooldown to Quick Tap scores only', async () => {
  const quickTapDatabase = new DatabaseSync(':memory:');
  const quickTapServer = createApp({
    database: quickTapDatabase,
    games: [{ id: 'quick-tap' }, { id: 'typer' }],
  }).listen(0);

  try {
    await new Promise((resolve) => quickTapServer.once('listening', resolve));
    const url = `http://127.0.0.1:${quickTapServer.address().port}/api/scores`;
    const submit = (gameId) => fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId, playerName: 'Ada', score: 10 }),
    });

    assert.equal((await submit('quick-tap')).status, 201);
    const repeatedQuickTap = await submit('quick-tap');
    assert.equal(repeatedQuickTap.status, 429);
    assert.ok(Number(repeatedQuickTap.headers.get('retry-after')) > 0);
    assert.equal((await submit('typer')).status, 201);
  } finally {
    await new Promise((resolve, reject) => quickTapServer.close((error) => error ? reject(error) : resolve()));
    quickTapDatabase.close();
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