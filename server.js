const express = require('express');
const fs = require('node:fs');
const { isIP } = require('node:net');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const root = __dirname;
const publicDirectory = path.join(root, 'public');
const gamesDirectory = path.join(root, 'games');
const registryPath = path.join(root, 'games.json');
const adminPagePath = path.join(publicDirectory, 'admin', 'index.html');

function createApp({ database, games = JSON.parse(fs.readFileSync(registryPath, 'utf8')), resolveClientIp = (request) => request.ip }) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS scores (
      id INTEGER PRIMARY KEY,
      game_id TEXT NOT NULL,
      player_name TEXT NOT NULL,
      score INTEGER NOT NULL CHECK (score >= 0),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS scores_by_game ON scores (game_id, score DESC, created_at ASC);
    CREATE TABLE IF NOT EXISTS client_sessions (
      client_ip TEXT PRIMARY KEY,
      registered_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      last_seen_at INTEGER
    );
  `);
  database.exec(`
    DELETE FROM scores
    WHERE EXISTS (
      SELECT 1 FROM scores AS better
      WHERE better.game_id = scores.game_id
        AND better.player_name = scores.player_name
        AND (
          better.score > scores.score
          OR (better.score = scores.score AND better.id < scores.id)
        )
    );
    CREATE UNIQUE INDEX IF NOT EXISTS scores_one_per_game_player ON scores (game_id, player_name);
  `);

  const knownGames = new Set(games.map((game) => game.id));
  const app = express();
  const scoreAttempts = new Map();
  const quickTapSubmissions = new Map();
  let scorePostCount = 0;
  app.use(express.json({ limit: '8kb' }));

  function normalizeIp(address) {
    const ip = String(address || '').trim().toLowerCase();
    return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  }

  function getClientIp(request) {
    return normalizeIp(resolveClientIp(request));
  }

  function isLoopbackIp(ip) {
    return ip === '::1' || ip.startsWith('127.');
  }

  function requireActiveClient(request, response, next) {
    const clientIp = getClientIp(request);
    if (isLoopbackIp(clientIp)) return next();

    const session = database.prepare(
      'SELECT expires_at AS expiresAt, last_seen_at AS lastSeenAt FROM client_sessions WHERE client_ip = ?'
    ).get(clientIp);
    const now = Date.now();
    if (!session || session.expiresAt <= now) {
      return response.status(403).json({
        error: session ? 'This device session has expired.' : 'This device is not registered for arcade access.',
        code: session ? 'session_expired' : 'session_unregistered',
      });
    }

    if (!session.lastSeenAt || now - session.lastSeenAt >= 30_000) {
      database.prepare('UPDATE client_sessions SET last_seen_at = ? WHERE client_ip = ?').run(now, clientIp);
    }
    return next();
  }

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

  app.get('/api/session', (request, response) => {
    const clientIp = getClientIp(request);
    if (isLoopbackIp(clientIp)) {
      return response.json({ clientIp, registered: true, active: true, isLocal: true, expiresAt: null, remainingMs: null });
    }

    const session = database.prepare(
      'SELECT registered_at AS registeredAt, expires_at AS expiresAt, last_seen_at AS lastSeenAt FROM client_sessions WHERE client_ip = ?'
    ).get(clientIp);
    if (!session) {
      return response.json({ clientIp, registered: false, active: false, expiresAt: null, remainingMs: 0, lastSeenAt: null });
    }

    const now = Date.now();
    const remainingMs = Math.max(0, session.expiresAt - now);
    if (remainingMs > 0 && (!session.lastSeenAt || now - session.lastSeenAt >= 30_000)) {
      database.prepare('UPDATE client_sessions SET last_seen_at = ? WHERE client_ip = ?').run(now, clientIp);
    }
    return response.json({
      clientIp,
      registered: true,
      active: remainingMs > 0,
      isLocal: false,
      expiresAt: session.expiresAt,
      remainingMs,
      lastSeenAt: session.lastSeenAt,
    });
  });

  app.get('/api/games', requireActiveClient, (_request, response) => response.json(games));

  app.post('/api/scores', requireActiveClient, (request, response, next) => {
    const { gameId, playerName, score } = request.body ?? {};
    const name = typeof playerName === 'string' ? playerName.trim().slice(0, 24) : '';
    request.isQuickTapRetry = gameId === 'quick-tap'
      && knownGames.has(gameId)
      && Number.isSafeInteger(score)
      && score >= 0
      && score <= 2147483647
      && Boolean(database.prepare('SELECT 1 FROM scores WHERE game_id = ? AND player_name = ?').get(gameId, name || 'Guest'));

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

    if (!request.isQuickTapRetry) {
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
    }

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
    if (gameId === 'quick-tap' && !request.isQuickTapRetry && previousQuickTapSubmission !== undefined && now - previousQuickTapSubmission < 10_000) {
      const retryAfter = Math.ceil((previousQuickTapSubmission + 10_000 - now) / 1000);
      response.set('Retry-After', String(retryAfter));
      return response.status(429).json({ error: 'Quick Tap scores can only be submitted once every 10 seconds.' });
    }

    const name = typeof playerName === 'string' ? playerName.trim().slice(0, 24) : '';
    const saved = database.prepare(`
      INSERT INTO scores (game_id, player_name, score) VALUES (?, ?, ?)
      ON CONFLICT (game_id, player_name) DO UPDATE SET
        score = MAX(scores.score, excluded.score),
        created_at = CASE
          WHEN excluded.score > scores.score THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          ELSE scores.created_at
        END
      RETURNING id, created_at AS createdAt, score
    `).get(gameId, name || 'Guest', score);
    if (gameId === 'quick-tap' && !request.isQuickTapRetry) quickTapSubmissions.set(request.ip, now);

    return response.status(201).json({
      id: saved.id,
      gameId,
      playerName: name || 'Guest',
      score: saved.score,
      createdAt: saved.createdAt,
    });
  });

  app.get('/api/leaderboard/:gameId', requireActiveClient, (request, response) => {
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

  app.get('/api/admin/sessions', (_request, response) => {
    const now = Date.now();
    const sessions = database.prepare(
      'SELECT client_ip AS clientIp, registered_at AS registeredAt, expires_at AS expiresAt, last_seen_at AS lastSeenAt FROM client_sessions ORDER BY last_seen_at DESC, registered_at DESC LIMIT 500'
    ).all();
    return response.json(sessions.map((session) => ({
      ...session,
      active: session.expiresAt > now,
      remainingMs: Math.max(0, session.expiresAt - now),
    })));
  });

  app.post('/api/admin/sessions', requireSameOrigin, (request, response) => {
    const clientIp = normalizeIp(request.body?.ip);
    const minutes = request.body?.minutes;
    if (isIP(clientIp) === 0 || isLoopbackIp(clientIp)) {
      return response.status(400).json({ error: 'Enter a non-local IPv4 or IPv6 address.' });
    }
    if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > 10080) {
      return response.status(400).json({ error: 'Minutes must be a whole number from 1 to 10080.' });
    }

    const now = Date.now();
    const existing = database.prepare('SELECT expires_at AS expiresAt FROM client_sessions WHERE client_ip = ?').get(clientIp);
    const expiresAt = Math.max(now, existing?.expiresAt ?? now) + minutes * 60_000;
    const session = database.prepare(`
      INSERT INTO client_sessions (client_ip, registered_at, expires_at, last_seen_at)
      VALUES (?, ?, ?, NULL)
      ON CONFLICT (client_ip) DO UPDATE SET expires_at = excluded.expires_at
      RETURNING client_ip AS clientIp, registered_at AS registeredAt, expires_at AS expiresAt, last_seen_at AS lastSeenAt
    `).get(clientIp, now, expiresAt);

    return response.status(201).json({ ...session, active: true, remainingMs: Math.max(0, expiresAt - now) });
  });

  app.delete('/api/admin/sessions', requireSameOrigin, (request, response) => {
    const clientIp = normalizeIp(request.body?.ip);
    if (isIP(clientIp) === 0 || isLoopbackIp(clientIp)) {
      return response.status(400).json({ error: 'Enter a non-local IPv4 or IPv6 address.' });
    }

    const result = database.prepare('DELETE FROM client_sessions WHERE client_ip = ?').run(clientIp);
    if (result.changes === 0) {
      return response.status(404).json({ error: 'Client session not found.' });
    }
    return response.status(204).end();
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
  app.use('/games', requireActiveClient, express.static(gamesDirectory));

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