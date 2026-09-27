// Double-Bid Euchre server: static file host + authoritative WebSocket game server.
// Run:  node server.js   (PORT env var optional, default 3000)

const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { Game, effectiveSuit, legalCards } = require('./game');
const bots = require('./bots');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const CODE_ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const BOT_NAMES = ['Rusty', 'Lucky', 'Dot', 'Ace', 'Chip', 'Pepper'];

const rooms = new Map(); // code -> room

function makeCode() {
  let c;
  do {
    c = Array.from({ length: 4 }, () => CODE_ALPHA[Math.floor(Math.random() * CODE_ALPHA.length)]).join('');
  } while (rooms.has(c));
  return c;
}

function newRoom() {
  const room = { code: makeCode(), seats: [null, null, null, null], game: null, lastActive: Date.now() };
  rooms.set(room.code, room);
  return room;
}

function touch(room) {
  room.lastActive = Date.now();
}

function seatOf(room, ws) {
  return room.seats.findIndex((s) => s && s.ws === ws);
}

function send(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function lobbyState(room, you) {
  return {
    t: 'lobby',
    code: room.code,
    you,
    isHost: you === 0,
    seats: room.seats.map((s) =>
      s ? { name: s.name, connected: s.connected, bot: !!s.bot } : null
    ),
  };
}

function gameState(room, you) {
  return {
    t: 'state',
    code: room.code,
    you,
    isHost: you === 0,
    connected: room.seats.map((s) => (s ? s.connected : false)),
    bots: room.seats.map((s) => !!(s && s.bot)),
    game: room.game.stateFor(you),
  };
}

function broadcast(room) {
  touch(room);
  room.seats.forEach((s, i) => {
    if (!s || !s.connected || s.bot) return; // bots don't get socket messages
    send(s.ws, room.game ? gameState(room, i) : lobbyState(room, i));
  });
  pumpBots(room);
}

// If it's a bot seat's turn, have the bot act after a short human-like pause.
function pumpBots(room) {
  if (room.botTimer) {
    clearTimeout(room.botTimer);
    room.botTimer = null;
  }
  const g = room.game;
  if (!g || g.phase === 'gameOver' || g.phase === 'handEnd') return;
  if (g.trick.length === 4) return; // Stop bots while 4 cards are sitting on the table
  let seat = -1;
  if (g.phase === 'bidding') seat = g.bidding.turn;
  else if (g.phase === 'naming' || g.phase === 'playing') seat = g.turn;
  if (seat < 0 || !room.seats[seat] || !room.seats[seat].bot) return;
  room.botTimer = setTimeout(() => {
    room.botTimer = null;
    room.botTimer = null;
    try {
      if (g.phase === 'bidding' && g.bidding.turn === seat) g.bid(seat, bots.chooseBid(g, seat));
      else if (g.phase === 'naming' && g.turn === seat) g.nameTrump(seat, bots.chooseTrump(g, seat));
      else if (g.phase === 'playing' && g.turn === seat) g.play(seat, bots.chooseCard(g, seat));
      else return;
    } catch (e) {
      // ultra-safe fallback so a bot can never stall the game
      try {
        if (g.phase === 'bidding') g.bid(seat, 'pass');
        else if (g.phase === 'naming') g.nameTrump(seat, 'S');
        else if (g.phase === 'playing') {
          const led = g.trick.length ? effectiveSuit(g.trick[0].card, g.contract) : null;
          const legal = legalCards(g.hands[seat], g.contract, led);
          g.play(seat, legal[0].id);
        }
      } catch {}
      return;
    }
    broadcast(room);
  }, botDelay());
}

// Pause before a bot acts: human-like in production, near-zero under test.
function botDelay() {
  if (process.env.BOT_DELAY_MS) return Number(process.env.BOT_DELAY_MS);
  return 700 + Math.random() * 800;
}

function err(ws, msg) {
  send(ws, { t: 'error', msg });
}

function cleanName(n) {
  return String(n || '').trim().slice(0, 14);
}

// ---- message handlers ----
function onMessage(ws, raw) {
  let m;
  try {
    m = JSON.parse(raw);
  } catch {
    return err(ws, 'Bad message');
  }
  const room = ws.roomCode ? rooms.get(ws.roomCode) : null;

  try {
    switch (m.t) {
      case 'create': {
        const name = cleanName(m.name);
        if (!name) return err(ws, 'Enter your name');
        const r = newRoom();
        r.seats[0] = { name, ws, connected: true };
        ws.roomCode = r.code;
        send(ws, { t: 'welcome', code: r.code, seat: 0 });
        broadcast(r);
        break;
      }
      case 'join': {
        const name = cleanName(m.name);
        const code = String(m.code || '').trim().toUpperCase();
        if (!name) return err(ws, 'Enter your name');
        const r = rooms.get(code);
        if (!r) return err(ws, 'No game with that code');
        // reclaim seat by name (reconnect)
        let seat = r.seats.findIndex(
          (s) => s && s.name.toLowerCase() === name.toLowerCase()
        );
        if (seat === -1) {
          seat = r.seats.findIndex((s) => s === null);
          if (seat === -1) return err(ws, 'That game is full');
          r.seats[seat] = { name, ws, connected: true };
        } else {
          r.seats[seat].ws = ws;
          r.seats[seat].connected = true;
        }
        ws.roomCode = r.code;
        send(ws, { t: 'welcome', code: r.code, seat });
        broadcast(r);
        break;
      }
      case 'start': {
        if (!room) return err(ws, 'No game');
        const seat = seatOf(room, ws);
        if (seat !== 0) return err(ws, 'Only the host can start');
        if (room.game) return err(ws, 'Game already started');
        if (room.seats.some((s) => !s)) return err(ws, 'Need 4 players to start');
        room.game = new Game(room.seats.map((s) => s.name));
        broadcast(room);
        break;
      }
      case 'addbot': {
        if (!room) return err(ws, 'No game');
        if (seatOf(room, ws) !== 0) return err(ws, 'Only the host can add bots');
        if (room.game) return err(ws, 'Game already started');
        const at = Number(m.seat);
        if (!Number.isInteger(at) || at < 0 || at > 3 || room.seats[at]) return err(ws, 'Bad seat');
        const used = new Set(room.seats.filter(Boolean).map((s) => s.name));
        const name = BOT_NAMES.find((n) => !used.has(n)) || `Bot ${at + 1}`;
        room.seats[at] = { name, ws: null, connected: true, bot: true };
        broadcast(room);
        break;
      }
      case 'removebot': {
        if (!room) return err(ws, 'No game');
        if (seatOf(room, ws) !== 0) return err(ws, 'Only the host can remove bots');
        if (room.game) return err(ws, 'Game already started');
        const at = Number(m.seat);
        if (!Number.isInteger(at) || at < 0 || at > 3 || !room.seats[at] || !room.seats[at].bot)
          return err(ws, 'No bot there');
        room.seats[at] = null;
        broadcast(room);
        break;
      }
      case 'bid': {
        if (!room || !room.game) return err(ws, 'No game');
        const seat = seatOf(room, ws);
        const amount = m.amount === 'pass' ? 'pass' : Number(m.amount);
        room.game.bid(seat, amount);
        broadcast(room);
        break;
      }
      case 'pass': {
        // alias: some clients send {t:'pass'} instead of {t:'bid', amount:'pass'}
        if (!room || !room.game) return err(ws, 'No game');
        const seat = seatOf(room, ws);
        room.game.bid(seat, 'pass');
        broadcast(room);
        break;
      }
      case 'trump': {
        if (!room || !room.game) return err(ws, 'No game');
        const seat = seatOf(room, ws);
        room.game.nameTrump(seat, String(m.trump).toUpperCase());
        broadcast(room);
        break;
      }
     case 'play': {
        if (!room || !room.game) return err(ws, 'No game');
        const seat = seatOf(room, ws);
        room.game.play(seat, String(m.card));
        broadcast(room);

        if (room.game.trick.length === 4) {
          setTimeout(() => {
            if (room.game) {
              room.game.clearTrick();
              broadcast(room);
              pumpBots(room); // <--- Triggers the winner/bot to play the next lead!
            }
          }, 3000);
        }
        break;
      }
      case 'next': {
        if (!room || !room.game) return err(ws, 'No game');
        try {
          room.game.nextHand();
        } catch {
          break; // someone already advanced the hand; ignore duplicate taps
        }
        broadcast(room);
        break;
      }
      case 'rematch': {
        if (!room || !room.game) return err(ws, 'No game');
        const seat = seatOf(room, ws);
        if (seat !== 0) return err(ws, 'Only the host can start a rematch');
        room.game.resetMatch();
        broadcast(room);
        break;
      }
      case 'leave': {
        if (!room) return;
        const seat = seatOf(room, ws);
        if (seat === -1) return;
        if (!room.game) {
          room.seats[seat] = null; // free the seat in lobby
          ws.roomCode = null;
          send(ws, { t: 'left' });
          broadcast(room);
        } else {
          // mid-game: keep the seat reserved so they can rejoin
          room.seats[seat].connected = false;
          ws.roomCode = null;
          send(ws, { t: 'left' });
          broadcast(room);
        }
        break;
      }
      default:
        err(ws, 'Unknown message');
    }
  } catch (e) {
    err(ws, e.message || 'Something went wrong');
  }
}

// ---- static files ----
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(PUBLIC, p);
  if (!file.startsWith(PUBLIC)) {
    res.writeHead(403);
    return res.end('nope');
  }
  fs.readFile(file, (e, data) => {
    if (e) {
      res.writeHead(404);
      return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });
wss.on('connection', (ws) => {
  ws.on('message', (raw) => onMessage(ws, raw));
  ws.on('close', () => {
    const room = ws.roomCode ? rooms.get(ws.roomCode) : null;
    if (!room) return;
    const seat = seatOf(room, ws);
    if (seat !== -1) {
      room.seats[seat].connected = false;
      broadcast(room);
    }
  });
});

// cleanup: drop rooms where nobody is connected for 30+ minutes
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const anyone = room.seats.some((s) => s && s.connected && !s.bot);
    if (!anyone && now - room.lastActive > 30 * 60 * 1000) rooms.delete(code);
  }
}, 5 * 60 * 1000);

server.listen(PORT, () => console.log(`Double-Bid Euchre on http://localhost:${PORT}`));
