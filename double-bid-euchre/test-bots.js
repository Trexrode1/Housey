// Bot tests: (1) direct engine simulation, 4 bots, many hands; (2) protocol game,
// 1 human + 3 server-side bots, played to completion.
const { spawn } = require('child_process');
const WebSocket = require('ws');
const G = require('./game');
const bots = require('./bots');
const assert = require('assert');

// ---- 1. direct simulation, no timers ----
{
  for (let gameN = 0; gameN < 3; gameN++) {
    const game = new G.Game(['b0', 'b1', 'b2', 'b3']);
    let guard = 0;
    let hussySeen = false, highSeen = false;
    while (game.phase !== 'gameOver' && guard++ < 5000) {
      if (game.phase === 'bidding') {
        const s = game.bidding.turn;
        const choice = bots.chooseBid(game, s);
        const valid = game.validBids();
        assert.ok(choice === 'pass' || valid.includes(choice), `illegal bot bid ${choice}`);
        if (choice === 12) hussySeen = true;
        game.bid(s, choice);
      } else if (game.phase === 'naming') {
        const s = game.turn;
        const t = bots.chooseTrump(game, s);
        const hussy = game.bidding.high.amount === 12;
        assert.ok(['S', 'H', 'D', 'C'].includes(t) || (t === 'HIGH' && hussy), `illegal trump ${t}`);
        if (t === 'HIGH') highSeen = true;
        game.nameTrump(s, t);
      } else if (game.phase === 'playing') {
        const s = game.turn;
        const id = bots.chooseCard(game, s);
        const led = game.trick.length ? G.effectiveSuit(game.trick[0].card, game.contract) : null;
        const legal = G.legalCards(game.hands[s], game.contract, led);
        assert.ok(legal.some((c) => c.id === id), 'bot played illegal card');
        game.play(s, id);
      } else if (game.phase === 'handEnd') {
        game.nextHand();
      }
    }
    assert.strictEqual(game.phase, 'gameOver', 'bot game did not finish');
    console.log(`bot game ${gameN + 1}: winner team ${game.winner}, scores ${game.scores}, hands ${game.handNo}`);
  }
  console.log('direct bot simulation ok');
}

// ---- 2. protocol: 1 human + 3 bots ----
const PORT = 4101;
const server = spawn('node', ['server.js'], {
  cwd: __dirname,
  env: { ...process.env, PORT: String(PORT), BOT_DELAY_MS: '15' },
  stdio: 'ignore',
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (n) => Math.floor(Math.random() * n);

(async () => {
  await sleep(800);
  const ws = new WebSocket(`ws://localhost:${PORT}`);
  await new Promise((r) => ws.on('open', r));
  let state = null, lobby = null, code = null;
  const send = (o) => ws.send(JSON.stringify(o));
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.t === 'welcome') code = m.code;
    else if (m.t === 'lobby') lobby = m;
    else if (m.t === 'state') { state = m; act(m); }
    else if (m.t === 'error') throw new Error('server error: ' + m.msg);
  });
  const G2 = G;
  function act(m) {
    const g = m.game;
    if (g.phase === 'bidding' && g.turn === m.you) {
      if (!g.validBids.length) send({ t: 'pass' });
      else if (!g.bid) send({ t: 'bid', amount: 6 });
      else send({ t: 'pass' });
    } else if (g.phase === 'naming' && g.turn === m.you) {
      send({ t: 'trump', trump: 'S' });
    } else if (g.phase === 'playing' && g.turn === m.you) {
      const led = g.trick.length ? G2.effectiveSuit(g.trick[0].card, g.contract) : null;
      const legal = G2.legalCards(g.hand, g.contract, led);
      send({ t: 'play', card: legal[0].id });
    } else if (g.phase === 'handEnd') send({ t: 'next' });
  }

  send({ t: 'create', name: 'Tim' });
  await sleep(400);
  for (const seat of [1, 2, 3]) { send({ t: 'addbot', seat }); await sleep(200); }
  const botSeats = lobby.seats.filter((s) => s && s.bot).length;
  assert.strictEqual(botSeats, 3, 'expected 3 bots in lobby');
  console.log('lobby with 3 bots ok:', lobby.seats.map((s) => (s ? s.name : '-')).join(', '));
  send({ t: 'start' });

  const t0 = Date.now();
  while (Date.now() - t0 < 120000) {
    await sleep(500);
    if (state && state.game.phase === 'gameOver') {
      console.log(`BOT GAME OVER — winner team ${state.game.winner}, scores ${state.game.scores}, hands ${state.game.handNo}`);
      // bots must appear in seat info
      assert.deepStrictEqual(state.bots, [false, true, true, true]);
      console.log('ALL BOT TESTS PASSED');
      server.kill();
      process.exit(0);
    }
  }
  throw new Error('timed out');
})().catch((e) => { console.error('FAIL:', e.message); server.kill(); process.exit(1); });
