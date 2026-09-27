# Double-Bid Euchre — online multiplayer

A real-time card game for **Tim's house rules**: 4 players, partners across,
48-card double deck (two 9–A sets), 12 cards each, minimum bid 6, first to 62.
Private rooms with a 4-letter code, plus computer players when you're short.

## House rules implemented

- Bidding starts left of the dealer. Bids 6–11 name the number of tricks;
  high bidder names the trump suit and leads the first trick.
- Outbid or pass; you may re-enter after passing. 3 passes in a row ends bidding.
- **HUSSY**: bid **12** to take all 12 tricks. Made = **+24**, set = **−12**.
- **No-trump ("High", aces high) may only be named on a hussy.**
- Right bower (J of trump) > left bower (J of same color) > A-K-Q-10-9.
  Two identical cards: the first one played wins the trick. Must follow suit
  (left bower counts as trump).
- Scoring: make your bid → 1 point per trick taken. Miss it → minus your bid.
  Defenders always score 1 per trick taken. First team to **62** wins.
- If all four players pass, the hand is redealt (dealer rotates).

## Run it locally

```bash
npm install
npm start        # serves http://localhost:3000
```

Open the URL on your phone and computer — one hosts, the others join with
the room code. Everyone must be able to reach the machine running the server
(same Wi-Fi works; for play across the internet, host it — see below).

## Bots

Short a player? In the lobby the host can **Add bot** to any empty seat
(up to 3 bots). Bots bid, name trump, and play with casual-level strategy.
Remove them the same way before starting.

## Put it on the internet (free)

The server is a single Node process with no database, so it fits any
free host. Easiest options:

**Railway** (no Dockerfile needed, but ours works too)
1. Push this folder to a GitHub repo.
2. railway.app → New Project → Deploy from GitHub repo.
3. It auto-detects Node and runs `npm start`. Railway gives you a public URL.

**Fly.io**
```bash
fly launch   # accept the Dockerfile build, no database
fly deploy
fly open
```

**Render**
1. New → Web Service → point at your repo.
2. Build command `npm install`, start command `npm start`. Free tier works.

Any host that can run `node server.js` on a public port works — the game
uses WebSockets on the same port, so no extra config is needed. The `PORT`
env var is respected.

## Project layout

- `server.js` — static file host + authoritative WebSocket game server
  (rooms, private codes, reconnect-by-name, bot driver).
- `game.js` — the rules engine (deck, bidding, bowers, trick resolution, scoring).
- `bots.js` — computer-player strategy.
- `public/` — the mobile-friendly web client (no build step, no framework).
- `test-engine.js`, `test-bots.js`, `test-integration.js` — automated tests
  (`npm test` runs the engine + bot suites).

## Notes

- The server keeps games in memory; restarting it ends active games.
- Rooms with no human connected for 30 minutes are cleaned up.
- If a player disconnects mid-game, their seat is held — they rejoin with
  the same name and room code and pick up where they left off.
