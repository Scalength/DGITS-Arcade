# DGITS Arcade

A local arcade launcher with a live SQLite leaderboard and an iframe score bridge.

## Requirements

- Node.js 22.13 or newer (the server uses the built-in `node:sqlite` module)
- npm

## Run locally

```sh
npm install
npm start
```

to locall host po follow this:

$env:Host = '0.0.0.0'
npm start
ipconfig
192.168.1.xx

goto http://192.168.1.xx:3000


Open [http://localhost:3000](http://localhost:3000). Scores are stored in `data/arcade.sqlite`. Set `PORT`, `HOST`, or `DB_PATH` to override the defaults. The server binds to `127.0.0.1` by default.

## Admin panel

Open [http://admin.localhost:3000](http://admin.localhost:3000) or [http://localhost:3000/admin](http://localhost:3000/admin) to review and remove leaderboard entries. Admin access is limited to loopback requests, and delete requests must be same-origin.

## Client sessions

LAN devices must be registered by IP in the admin panel before they can load games or submit scores. Enter the device IP and the number of minutes to grant; additional grants extend its current expiry. New grants default to 60 minutes. The arcade shows the remaining time and unloads the game when the session expires. Loopback access on the host is exempt.

## Score API

- `GET /api/games` returns the `games.json` registry.
- `POST /api/scores` accepts `{ "gameId": "quick-tap", "playerName": "Ada", "score": 120 }`.
- `GET /api/leaderboard/:gameId` returns the top 10 scores; `?limit=` accepts values from 1 to 100.

Unknown games and non-integer or negative scores are rejected. Names are trimmed, limited to 24 characters, and default to `Guest`.

## Game bridge

The parent page accepts score messages only from the active, same-origin game iframe. Load `/sdk/arcade-sdk.js` in a game at `/games/<gameId>/` and submit a score like this:

```js
window.ArcadeSDK.submitScore({ score: 120, playerName: 'Ada' });
```

Add new games to `games.json` and place their `index.html` at `games/<gameId>/index.html`.

## Tests

```sh
npm test
```