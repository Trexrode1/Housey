// Engine sanity tests
const G = require('./game');
const assert = require('assert');

const card = (rank, suit, copy = 1) => ({ id: `${rank}${suit}${copy}`, rank, suit, copy });

// 1. deck + deal
{
  const deck = G.buildDeck();
  assert.strictEqual(deck.length, 48);
  assert.strictEqual(new Set(deck.map((c) => c.id)).size, 48);
  const game = new G.Game(['a', 'b', 'c', 'd']);
  assert.deepStrictEqual(game.hands.map((h) => h.length), [12, 12, 12, 12]);
  console.log('deck/deal ok');
}

// 2. bowers with trump=S
{
  const c = { type: 'suit', trump: 'S' };
  assert.strictEqual(G.effectiveSuit(card('J', 'S'), c), 'S'); // right
  assert.strictEqual(G.effectiveSuit(card('J', 'C'), c), 'S'); // left
  assert.strictEqual(G.effectiveSuit(card('J', 'H'), c), 'H'); // not bower
  assert.strictEqual(G.effectiveSuit(card('A', 'S'), c), 'S');
  // left bower must follow trump
  const hand = [card('J', 'C'), card('9', 'H')];
  const legal = G.legalCards(hand, c, 'S');
  assert.strictEqual(legal.length, 1);
  assert.strictEqual(legal[0].suit, 'C');
  console.log('bowers ok');
}

// 3. trick winner: right > left > A trump; identical first-played wins
{
  const c = { type: 'suit', trump: 'H' };
  const plays = [
    { seat: 0, card: card('A', 'H') },
    { seat: 1, card: card('J', 'H') }, // right bower
    { seat: 2, card: card('J', 'D') }, // left bower
    { seat: 3, card: card('9', 'S') },
  ];
  assert.strictEqual(G.trickWinner(plays, c), 1);
  // identical cards: first played wins
  const plays2 = [
    { seat: 0, card: card('A', 'S', 1) },
    { seat: 1, card: card('A', 'S', 2) },
    { seat: 2, card: card('K', 'S', 1) },
    { seat: 3, card: card('Q', 'S', 1) },
  ];
  assert.strictEqual(G.trickWinner(plays2, { type: 'suit', trump: 'H' }), 0);
  // high contract: no bowers, ace high of led suit
  const plays3 = [
    { seat: 0, card: card('J', 'S', 1) },
    { seat: 1, card: card('A', 'S', 1) },
    { seat: 2, card: card('J', 'S', 2) },
    { seat: 3, card: card('9', 'H', 1) },
  ];
  assert.strictEqual(G.trickWinner(plays3, { type: 'high', trump: null }), 1);
  console.log('trick winner ok');
}

// 4. full random game to completion
{
  const game = new G.Game(['a', 'b', 'c', 'd']);
  let guard = 0;
  const rnd = (n) => Math.floor(Math.random() * n);
  while (game.phase !== 'gameOver' && guard++ < 5000) {
    if (game.phase === 'bidding') {
      const s = game.stateFor(game.bidding.turn);
      const opts = s.validBids;
      const cur = game.bidding.high;
      if (opts.length === 0) game.bid(game.bidding.turn, 'pass');
      else if (!cur) {
        // open: usually 6, sometimes a hussy for coverage
        game.bid(game.bidding.turn, Math.random() < 0.08 ? 12 : 6);
      } else if (cur.amount < 9 && Math.random() < 0.25) {
        game.bid(game.bidding.turn, cur.amount + 1); // occasional raise
      } else game.bid(game.bidding.turn, 'pass');
    } else if (game.phase === 'naming') {
      const st = game.stateFor(game.turn);
      const choices = ['S', 'H', 'D', 'C'];
      if (st.canGoHigh && Math.random() < 0.3) game.nameTrump(game.turn, 'HIGH');
      else game.nameTrump(game.turn, choices[rnd(4)]);
    } else if (game.phase === 'playing') {
      const s = game.turn;
      const st = game.stateFor(s);
      const led = st.trick.length ? G.effectiveSuit(st.trick[0].card, game.contract) : null;
      const legal = G.legalCards(game.hands[s], game.contract, led);
      game.play(s, legal[rnd(legal.length)].id);
    } else if (game.phase === 'handEnd') {
      game.nextHand();
    }
  }
  assert.strictEqual(game.phase, 'gameOver');
  assert.ok(game.scores[game.winner] >= G.WIN_SCORE);
  console.log(`full game ok — winner team ${game.winner}, scores ${game.scores}, hands ${game.handNo}`);
}

// 5. hussy scoring paths (forced)
{
  const game = new G.Game(['a', 'b', 'c', 'd']);
  // force: seat 1 bids hussy, names trump, then rig hands so makers take all
  game.bid(game.bidding.turn, 'pass'); // seat1 passes? no—bid.turn starts at 1 (dealer 0)
  // simpler: directly set a hussy contract and empty-ish hands
  game.phase = 'naming'; game.bidding.high = { seat: 0, amount: 12 };
  game.nameTrump(0, 'S');
  // give team 0 all spades/aces... easiest: make every trick won by seat 0 by rigging:
  // replace hands: seat0 gets 12 aces-high trump... simpler to test finishHand math directly:
  game.tricksWon = [12, 0];
  game.hands = [[], [], [], []];
  game.finishHand();
  assert.strictEqual(game.scores[0], 24);
  assert.strictEqual(game.scores[1], 0);
  console.log('hussy made ok');
}
{
  const game = new G.Game(['a', 'b', 'c', 'd']);
  game.phase = 'naming'; game.bidding.high = { seat: 1, amount: 12 };
  game.nameTrump(1, 'HIGH');
  game.tricksWon = [3, 9]; // team of seat1 is team 1 -> makers took 9
  game.hands = [[], [], [], []];
  game.finishHand();
  assert.strictEqual(game.scores[1], -12);
  assert.strictEqual(game.scores[0], 3);
  console.log('hussy set ok');
}

// 6. normal set: bid 8, take 6 -> -8; defenders get their tricks
{
  const game = new G.Game(['a', 'b', 'c', 'd']);
  game.phase = 'naming'; game.bidding.high = { seat: 2, amount: 8 };
  game.nameTrump(2, 'D');
  game.tricksWon = [6, 6]; // seat2 is team 0 -> makers 6 < 8
  game.hands = [[], [], [], []];
  game.finishHand();
  assert.strictEqual(game.scores[0], -8);
  assert.strictEqual(game.scores[1], 6);
  console.log('normal set ok');
}

// 7. naming HIGH without hussy throws
{
  const game = new G.Game(['a', 'b', 'c', 'd']);
  game.phase = 'naming'; game.bidding.high = { seat: 0, amount: 9 };
  assert.throws(() => game.nameTrump(0, 'HIGH'), /only allowed on a hussy/);
  console.log('high-only-on-hussy ok');
}

console.log('ALL ENGINE TESTS PASSED');
