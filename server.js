const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const root = __dirname;
const publicDirectory = path.join(root, 'public');
const gamesDirectory = path.join(root, 'games');
const registryPath = path.join(root, 'games.json');
const adminPagePath = path.join(publicDirectory, 'admin', 'index.html');

function createApp({ database, games = JSON.parse(fs.readFileSync(registryPath, 'utf8')) }) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS scores (
      id INTEGER PRIMARY KEY,
      game_id TEXT NOT NULL,
      player_name TEXT NOT NULL,
      score INTEGER NOT NULL CHECK (score >= 0),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS scores_by_game ON scores (game_id, score DESC, created_at ASC);
  `);

  const knownGames = new Set(games.map((game) => game.id));
  const app = express();
  const scoreAttempts = new Map();
  const quickTapSubmissions = new Map();
  let scorePostCount = 0;
  app.use(express.json({ limit: '8kb' }));

  function requireLocalAdmin(request, response, next) {
    const hostname = request.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const remoteAddress = request.socket.remoteAddress || '';
    const localHost = ['localhost', 'admin.localhost', '127.0.0.1', '::1'].includes(hostname);
    const loopbackAddress = remoteAddress === '::1' || remoteAddress.startsWith('127.') || remoteAddress.startsWith('::ffff:127.');
    if (!localHost || !loopbackAddress) {
      return response.status(403).json({ error: 'Admin access is available only from localhost.' });
    }
    return next();
  }

  function requireSameOrigin(request, response, next) {
    let originHost;
    try {
      originHost = new URL(request.get('origin')).host;
    } catch {
      originHost = null;
    }
    if (originHost !== request.get('host')) {
      return response.status(403).json({ error: 'Admin requests must come from the same origin.' });
    }
    return next();
  }

  app.use(['/admin', '/api/admin'], requireLocalAdmin);

  app.get('/api/games', (_request, response) => response.json(games));

  app.post('/api/scores', (request, response, next) => {
    const now = Date.now();
    scorePostCount++;
    if (scorePostCount % 256 === 0) {
      for (const [ip, attempt] of scoreAttempts) {
        if (now - attempt.startedAt >= 60_000) scoreAttempts.delete(ip);
      }
      for (const [ip, submittedAt] of quickTapSubmissions) {
        if (now - submittedAt >= 10_000) quickTapSubmissions.delete(ip);
      }
    }

    let attempt = scoreAttempts.get(request.ip);
    if (!attempt || now - attempt.startedAt >= 60_000) {
      attempt = { startedAt: now, count: 0 };
      scoreAttempts.set(request.ip, attempt);
    }
    if (attempt.count >= 10) {
      const retryAfter = Math.ceil((attempt.startedAt + 60_000 - now) / 1000);
      response.set('Retry-After', String(retryAfter));
      return response.status(429).json({ error: 'Too many score submissions. Try again later.' });
    }

    attempt.count++;
    return next();
  }, (request, response) => {
    const { gameId, playerName, score } = request.body ?? {};
    if (!knownGames.has(gameId)) {
      return response.status(400).json({ error: 'Unknown game.' });
    }
    if (!Number.isSafeInteger(score) || score < 0 || score > 2147483647) {
      return response.status(400).json({ error: 'Score must be a whole number from 0 to 2147483647.' });
    }

    const now = Date.now();
    const previousQuickTapSubmission = gameId === 'quick-tap' ? quickTapSubmissions.get(request.ip) : undefined;
    if (previousQuickTapSubmission !== undefined && now - previousQuickTapSubmission < 10_000) {
      const retryAfter = Math.ceil((previousQuickTapSubmission + 10_000 - now) / 1000);
      response.set('Retry-After', String(retryAfter));
      return response.status(429).json({ error: 'Quick Tap scores can only be submitted once every 10 seconds.' });
    }

    const name = typeof playerName === 'string' ? playerName.trim().slice(0, 24) : '';
    const saved = database.prepare(
      'INSERT INTO scores (game_id, player_name, score) VALUES (?, ?, ?) RETURNING id, created_at AS createdAt'
    ).get(gameId, name || 'Guest', score);
    if (gameId === 'quick-tap') quickTapSubmissions.set(request.ip, now);

    return response.status(201).json({
      id: saved.id,
      gameId,
      playerName: name || 'Guest',
      score,
      createdAt: saved.createdAt,
    });
  });

  app.get('/api/leaderboard/:gameId', (request, response) => {
    const { gameId } = request.params;
    if (!knownGames.has(gameId)) {
      return response.status(404).json({ error: 'Game not found.' });
    }

    const requestedLimit = Number.parseInt(request.query.limit, 10);
    const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 10;
    const scores = database.prepare(
      'SELECT player_name AS playerName, score, created_at AS createdAt FROM scores WHERE game_id = ? ORDER BY score DESC, created_at ASC LIMIT ?'
    ).all(gameId, limit);

    return response.json(scores.map((entry, index) => ({ rank: index + 1, ...entry })));
  });

  app.get('/api/admin/scores', (_request, response) => {
    const scores = database.prepare(
      'SELECT id, game_id AS gameId, player_name AS playerName, score, created_at AS createdAt FROM scores ORDER BY created_at DESC, id DESC LIMIT 500'
    ).all();
    return response.json(scores);
  });

  app.delete('/api/admin/scores/:id', requireSameOrigin, (request, response) => {
    const id = Number(request.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      return response.status(400).json({ error: 'Score ID must be a positive integer.' });
    }

    const result = database.prepare('DELETE FROM scores WHERE id = ?').run(id);
    if (result.changes === 0) {
      return response.status(404).json({ error: 'Score entry not found.' });
    }
    return response.status(204).end();
  });

  app.get('/', (request, response, next) => {
    if (request.hostname.toLowerCase() !== 'admin.localhost') return next();
    return requireLocalAdmin(request, response, () => response.sendFile(adminPagePath));
  });

  app.use(express.static(publicDirectory));
  app.use('/games', express.static(gamesDirectory));

  return app;
}

if (require.main === module) {
  const databasePath = process.env.DB_PATH || path.join(root, 'data', 'arcade.sqlite');
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  const app = createApp({ database });
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '127.0.0.1';
  app.listen(port, host, () => console.log(`DGITS Arcade is running at http://localhost:${port}`));
}

module.exports = { createApp };