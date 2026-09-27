// Double-Bid Euchre client
const $ = (id) => document.getElementById(id);
const GLYPH = { S: '♠', H: '♥', D: '♦', C: '♣' };
const RED = new Set(['H', 'D']);

let ws = null;
let myName = '', roomCode = '', mySeat = -1, isHost = false;
let selectedCard = null;
let toastTimer = null;

function show(view) {
  ['view-home', 'view-lobby', 'view-game'].forEach((v) => $(v).classList.toggle('hidden', v !== view));
}
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
}
const session = {
  load() { try { return JSON.parse(localStorage.getItem('dbe-session') || 'null'); } catch { return null; } },
  save(s) { localStorage.setItem('dbe-session', JSON.stringify(s)); },
  clear() { localStorage.removeItem('dbe-session'); },
};

function send(obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  else toast('Connecting…');
}

function connect() {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  ws.onopen = () => {
    $('conn').classList.add('hidden');
    const s = session.load();
    if (s && s.name && s.code) {
      myName = s.name;
      send({ t: 'join', code: s.code, name: s.name });
    }
  };
  ws.onmessage = (e) => handle(JSON.parse(e.data));
  ws.onclose = () => {
    $('conn').classList.remove('hidden');
    setTimeout(() => { if (!ws || ws.readyState === 3) connect(); }, 3000);
  };
}

function handle(m) {
  switch (m.t) {
    case 'welcome':
      roomCode = m.code; mySeat = m.seat;
      session.save({ name: myName, code: roomCode });
      break;
    case 'lobby':
      isHost = m.isHost; mySeat = m.you; roomCode = m.code;
      renderLobby(m);
      break;
    case 'state':
      isHost = m.isHost; mySeat = m.you; roomCode = m.code;
      renderGame(m);
      break;
    case 'error':
      toast(m.msg);
      if (/No game with that code|full/i.test(m.msg)) { session.clear(); show('view-home'); }
      break;
    case 'left':
      session.clear(); roomCode = ''; mySeat = -1;
      show('view-home');
      break;
  }
}

// ---------- lobby ----------
function renderLobby(m) {
  show('view-lobby');
  $('lobby-code').textContent = m.code;
  const box = $('lobby-players');
  box.innerHTML = '';
  const teamName = (s) => (s % 2 === 0 ? 'Team A' : 'Team B');
  m.seats.forEach((p, i) => {
    const d = document.createElement('div');
    d.className = 'player' + (p ? '' : ' empty');
    if (p) {
      const botBtn = (m.isHost && p.bot) ? ` <button class="ghost" data-lobby="removebot" data-seat="${i}" style="padding:6px 12px;font-size:13px">Remove</button>` : '';
      d.innerHTML =
        `<span>${i === m.you ? '<span class="you">YOU</span> · ' : ''}${escapeHtml(p.name)}` +
        `${p.bot ? ' <span class="team">[BOT]</span>' : ''}${p.connected ? '' : ' (away)'}</span>` +
        `<span class="team">${teamName(i)}${i === 0 ? ' · host' : ''}</span>${botBtn}`;
    } else if (m.isHost) {
      d.innerHTML = `<span>Seat ${i + 1} — empty</span>` +
        `<span><button data-lobby="addbot" data-seat="${i}" style="padding:6px 12px;font-size:13px">Add bot</button> ` +
        `<span class="team">${teamName(i)}</span></span>`;
    } else {
      d.innerHTML = `<span>Seat ${i + 1} — waiting…</span><span class="team">${teamName(i)}</span>`;
    }
    box.appendChild(d);
  });
  const full = m.seats.every(Boolean);
  $('btn-start').classList.toggle('hidden', !m.isHost);
  $('btn-start').disabled = !full;
  $('btn-start').textContent = full ? 'Start game' : 'Waiting for players…';
  $('lobby-err').textContent = '';
}

// ---------- game ----------
const rel = (seat) => (seat - mySeat + 4) % 4; // 0 bottom,1 left,2 top,3 right
const POS = ['bottom', 'left', 'top', 'right'];

function cardHTML(c, small) {
  return `<div class="card${small ? ' small' : ''}${RED.has(c.suit) ? ' red' : ''}" data-id="${c.id}">` +
    `<div class="rank">${c.rank}</div><div class="suit">${GLYPH[c.suit]}</div></div>`;
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x])); }

function teamNames(g, team) {
  return [0, 1, 2, 3].filter((s) => s % 2 === team).map((s) => g.names[s]).join(' & ');
}

function renderGame(m) {
  show('view-game');
  const g = m.game;
  const myTeam = mySeat % 2;

  // scorebar
  $('scorebar').innerHTML =
    `<div class="team"><div class="${myTeam === 0 ? 'me' : ''}">${escapeHtml(teamNames(g, 0))}</div><div class="sc">${g.scores[0]}</div></div>` +
    `<div class="mid">first to<br><b>62</b></div>` +
    `<div class="team right"><div class="${myTeam === 1 ? 'me' : ''}">${escapeHtml(teamNames(g, 1))}</div><div class="sc">${g.scores[1]}</div></div>`;

  // seats + trick
  const playedBy = {};
  g.trick.forEach((p) => { playedBy[p.seat] = p.card; });
  POS.forEach((pos, r) => {
    const seat = [0, 1, 2, 3].find((s) => rel(s) === r);
    const info = $(`seat-${pos}`);
    const isTurn = g.turn === seat && (g.phase === 'bidding' || g.phase === 'naming' || g.phase === 'playing');
    info.className = 'seatinfo' + (isTurn ? ' turn' : '') + (!m.connected[seat] ? ' away' : '');
    info.innerHTML = `<div class="n">${seat === mySeat ? 'YOU' : escapeHtml(g.names[seat])}` +
      `${m.bots && m.bots[seat] ? ' [BOT]' : ''}${g.dealer === seat ? ' (D)' : ''}</div><div class="c">${g.handCounts[seat]} cards</div>`;
    const pl = $(`played-${pos}`);
    pl.innerHTML = playedBy[seat] ? cardHTML(playedBy[seat], true) : '';
  });
  // trick center shows play order with names
  $('trick-center').innerHTML = g.trick.map((p) =>
    `<div class="tcard">${cardHTML(p.card, true)}<div class="who">${p.seat === mySeat ? 'YOU' : escapeHtml(p.name)}</div></div>`
  ).join('');

  // status
  $('status').innerHTML = statusHTML(g);

  // bid log
  $('bidlog').innerHTML = g.bidLog.length
    ? 'Bids: ' + g.bidLog.map((e) =>
        e.bid === 'pass' ? `${escapeHtml(e.name)} pass`
        : e.bid === 12 ? `<span class="hussy">${escapeHtml(e.name)} HUSSY</span>`
        : `${escapeHtml(e.name)} ${e.bid}`).join(' · ')
    : '';

  renderActionBar(m, g);
  renderHand(m, g);
}

function contractLine(g) {
  const c = g.contract;
  if (!c) return '';
  const trumpTxt = c.type === 'high' ? 'High (no trump)' : `${GLYPH[c.trump]} trump`;
  const need = c.hussy
    ? `<span class="hussy">HUSSY by ${escapeHtml(c.bidderName)} — must take all 12</span>`
    : `${escapeHtml(c.bidderName)} bid ${c.amount} · ${trumpTxt}`;
  const us = g.tricksWon[mySeat % 2], them = g.tricksWon[1 - (mySeat % 2)];
  return `${need}<br>Us ${us} – Them ${them}`;
}

function statusHTML(g) {
  const turnName = g.turn === mySeat ? 'YOU' : escapeHtml(g.names[g.turn] || '');
  switch (g.phase) {
    case 'bidding': {
      const cur = g.bid ? ` · current: <b>${g.bid.amount === 12 ? '<span class="hussy">HUSSY</span>' : g.bid.amount}</b> by ${escapeHtml(g.bid.by)}` : ` · min bid 6`;
      const t = g.turn === mySeat ? `<div class="big">Your bid${cur}</div>` : `Bidding${cur}<br>Waiting for <b>${turnName}</b>…`;
      return t + `<br><span style="opacity:.65;font-size:13px">${escapeHtml(g.message)}</span>`;
    }
    case 'naming':
      return g.turn === mySeat
        ? `<div class="big">You won the bid — name trump</div>`
        : `<div class="big">${turnName} won the bid</div>naming trump…`;
    case 'playing':
      return `${contractLine(g)}<br>` +
        (g.turn === mySeat ? `<div class="big">Your turn</div>` : `Waiting for <b>${turnName}</b>…`);
    case 'handEnd': {
      const r = g.lastResult;
      return `<div class="resultbox"><div class="big ${r.hussy ? 'hussy' : ''}">${escapeHtml(r.detail)}</div>` +
        `<div>${escapeHtml(r.bidder)} ${r.hussy ? 'went hussy' : `bid ${r.amount}`} · makers ${r.makersTricks} – defenders ${r.defendersTricks}</div>` +
        `<div style="margin-top:6px">Score: <b>${g.scores[0]}</b> – <b>${g.scores[1]}</b></div></div>`;
    }
    case 'gameOver': {
      const win = g.winner === mySeat % 2;
      return `<div class="resultbox"><div class="big">${win ? 'Your team wins!' : `${escapeHtml(teamNames(g, g.winner))} win!`}</div>` +
        `<div>Final: <b>${g.scores[0]}</b> – <b>${g.scores[1]}</b></div></div>`;
    }
  }
  return escapeHtml(g.message);
}

function renderActionBar(m, g) {
  const bar = $('actionbar');
  let h = '';
  if (g.phase === 'bidding' && g.turn === mySeat) {
    h += `<div class="title">Your bid</div>`;
    h += `<div class="cur">${g.bid ? `Current: ${g.bid.amount} by ${escapeHtml(g.bid.by)}` : 'No bids yet — minimum 6'}</div>`;
    g.validBids.forEach((b) => {
      h += b === 12
        ? `<button class="bidbtn hussybtn" data-act="bid" data-v="12">12 · HUSSY</button>`
        : `<button class="bidbtn" data-act="bid" data-v="${b}">${b}</button>`;
    });
    h += `<button class="passbtn" data-act="pass">Pass</button>`;
  } else if (g.phase === 'naming' && g.turn === mySeat) {
    h += `<div class="title">Name trump${g.canGoHigh ? ' (or go High — no trump)' : ''}</div>`;
    ['S', 'H', 'D', 'C'].forEach((s) => {
      h += `<button class="trumpbtn${RED.has(s) ? ' red' : ''}" data-act="trump" data-v="${s}" style="${RED.has(s) ? 'color:#c0272d' : ''}">${GLYPH[s]}</button>`;
    });
    if (g.canGoHigh) h += `<button data-act="trump" data-v="HIGH">High<br><small>no trump</small></button>`;
  } else if (g.phase === 'playing' && g.turn === mySeat) {
    h += `<button class="playbtn" data-act="play" ${selectedCard ? '' : 'disabled'}>Play card</button>`;
  } else if (g.phase === 'handEnd') {
    h += `<button class="primary" data-act="next" style="width:auto">Next hand →</button>`;
  } else if (g.phase === 'gameOver' && isHost) {
    h += `<button class="primary" data-act="rematch" style="width:auto">Rematch</button>`;
  }
  bar.innerHTML = h;
}

function renderHand(m, g) {
  const el = $('hand');
  if (selectedCard && !g.hand.some((c) => c.id === selectedCard)) selectedCard = null;
  el.innerHTML = g.hand.map((c) =>
    cardHTML(c, false).replace('class="card', `class="card${c.id === selectedCard ? ' sel' : ''}`)
  ).join('');
}

// ---------- events ----------
$('hand').addEventListener('click', (e) => {
  const cd = e.target.closest('.card');
  if (!cd) return;
  const id = cd.dataset.id;
  selectedCard = selectedCard === id ? null : id;
  document.querySelectorAll('#hand .card').forEach((el) =>
    el.classList.toggle('sel', el.dataset.id === selectedCard));
  const pb = document.querySelector('#actionbar [data-act="play"]');
  if (pb) pb.disabled = !selectedCard;
});

$('actionbar').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b || b.disabled) return;
  const act = b.dataset.act;
  if (act === 'bid') send({ t: 'bid', amount: Number(b.dataset.v) });
  else if (act === 'pass') send({ t: 'pass' });
  else if (act === 'trump') send({ t: 'trump', trump: b.dataset.v });
  else if (act === 'play' && selectedCard) { send({ t: 'play', card: selectedCard }); selectedCard = null; }
  else if (act === 'next') send({ t: 'next' });
  else if (act === 'rematch') send({ t: 'rematch' });
});

$('btn-host').addEventListener('click', () => {
  const n = $('name').value.trim();
  if (!n) { $('home-err').textContent = 'Enter your name first'; return; }
  $('home-err').textContent = '';
  myName = n;
  send({ t: 'create', name: n });
});
$('btn-join').addEventListener('click', () => {
  const n = $('name').value.trim();
  const c = $('code').value.trim().toUpperCase();
  if (!n) { $('home-err').textContent = 'Enter your name first'; return; }
  if (c.length !== 4) { $('home-err').textContent = 'Enter the 4-letter room code'; return; }
  $('home-err').textContent = '';
  myName = n;
  send({ t: 'join', code: c, name: n });
});
$('btn-start').addEventListener('click', () => send({ t: 'start' }));
$('btn-leave-lobby').addEventListener('click', () => send({ t: 'leave' }));
$('lobby-players').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-lobby]');
  if (!b) return;
  send({ t: b.dataset.lobby, seat: Number(b.dataset.seat) });
});

connect();
