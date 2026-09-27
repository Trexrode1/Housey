// Integration test: boots the real server, plays a full game with 4 WS clients,
// including a mid-game disconnect/reconnect. Run: node test-integration.js
const { spawn } = require('child_process');
const WebSocket = require('ws');
const G = require('./game');

const PORT = 4100;
const server = spawn('node', ['server.js'], {
  cwd: __dirname,
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (d) => process.stdout.write('[srv] ' + d));
server.stderr.on('data', (d) => process.stderr.write('[srv] ' + d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (n) => Math.floor(Math.random() * n);

function makeClient(name) {
  const c = { name, ws: null, seat: -1, state: null, errors: [], queue: [] };
  c.connect = () => new Promise((resolve) => {
    c.ws = new WebSocket(`ws://localhost:${PORT}`);
    c.ws.on('open', () => resolve());
    c.ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.t === 'welcome') c.seat = m.seat;
      else if (m.t === 'state') { c.state = m; maybeAct(c); }
      else if (m.t === 'lobby') c.state = m;
      else if (m.t === 'error') c.errors.push(m.msg);
    });
  });
  c.send = (o) => c.ws.send(JSON.stringify(o));
  return c;
}

const clients = [];
function maybeAct(c) {
  const m = c.state;
  if (!m || m.t !== 'state') return;
  const g = m.game;
  try {
    if (g.phase === 'bidding' && g.turn === m.you) {
      const cur = g.bid;
      if (g.validBids.length === 0) c.send({ t: 'pass' });
      else if (!cur) c.send({ t: 'bid', amount: Math.random() < 0.08 ? 12 : 6 });
      else if (cur.amount < 9 && Math.random() < 0.25) c.send({ t: 'bid', amount: cur.amount + 1 });
      else c.send({ t: 'pass' });
    } else if (g.phase === 'naming' && g.turn === m.you) {
      if (g.canGoHigh && Math.random() < 0.3) c.send({ t: 'trump', trump: 'HIGH' });
      else c.send({ t: 'trump', trump: ['S', 'H', 'D', 'C'][rnd(4)] });
    } else if (g.phase === 'playing' && g.turn === m.you) {
      const led = g.trick.length ? G.effectiveSuit(g.trick[0].card, g.contract) : null;
      const legal = G.legalCards(g.hand, g.contract, led);
      c.send({ t: 'play', card: legal[rnd(legal.length)].id });
    } else if (g.phase === 'handEnd') {
      c.send({ t: 'next' });
    }
  } catch (e) { /* ignore */ }
}

(async () => {
  await sleep(800);
  const names = ['Tim', 'Ana', 'Bob', 'Sue'];
  for (const n of names) {
    const c = makeClient(n);
    await c.connect();
    clients.push(c);
  }
  clients[0].send({ t: 'create', name: 'Tim' });
  await sleep(400);
  const code = clients[0].seat !== -1 ? null : null;
  // get code from lobby broadcast
  const lobby = clients[0].state;
  if (!lobby || lobby.t !== 'lobby') throw new Error('no lobby after create: ' + JSON.stringify(lobby));
  const roomCode = lobby.code;
  console.log('room code:', roomCode);
  for (let i = 1; i < 4; i++) clients[i].send({ t: 'join', code: roomCode, name: names[i] });
  await sleep(400);
  clients[0].send({ t: 'start' });

  const t0 = Date.now();
  let reconnected = false;
  let hands = 0, lastHandNo = 0;
  while (Date.now() - t0 < 120000) {
    await sleep(300);
    const st = clients[0].state;
    if (st && st.t === 'state') {
      if (st.game.handNo !== lastHandNo) {
        lastHandNo = st.game.handNo;
        hands++;
        console.log(`hand ${lastHandNo} scores ${st.game.scores} phase ${st.game.phase}`);
        // mid-game reconnect test after hand 2 starts
        if (!reconnected && lastHandNo === 2) {
          reconnected = true;
          console.log('--- disconnecting Bob, reconnecting ---');
          clients[2].ws.close();
          await sleep(600);
          const nb = makeClient('Bob');
          await nb.connect();
          nb.send({ t: 'join', code: roomCode, name: 'Bob' });
          await sleep(600);
          if (nb.seat !== 2) throw new Error(`reconnect got seat ${nb.seat}, expected 2`);
          if (!nb.state || nb.state.t !== 'state') throw new Error('reconnected client got no game state');
          console.log('--- Bob reconnected to seat 2, game state received ---');
          clients[2] = nb;
        }
      }
      if (st.game.phase === 'gameOver') {
        console.log(`GAME OVER — winner team ${st.game.winner}, scores ${st.game.scores}, hands ${st.game.handNo}`);
        const bad = clients.flatMap((c) => c.errors);
        if (bad.length) throw new Error('client errors: ' + bad.join(' | '));
        console.log('reconnect test passed, no protocol errors');
        console.log('ALL INTEGRATION TESTS PASSED');
        server.kill();
        process.exit(0);
      }
    }
  }
  throw new Error('timed out waiting for game over');
})().catch((e) => {
  console.error('FAIL:', e.message);
  server.kill();
  process.exit(1);
});
