// Computer players for Double-Bid Euchre (Tim's house rules).
// The server calls these when it's a bot seat's turn. Bots are casual-strength:
// sensible bids, trump choice, and trick play — not sharks.

const {
  SUITS, RANK_VAL, MAX_BID, effectiveSuit, cardPower, legalCards, trickWinner, teamOf,
} = require('./game');

const RED = new Set(['H', 'D']);
const sameColor = (a, b) => RED.has(a) === RED.has(b);

// Rough trick estimate for a hand if `trump` were named.
// EST_SCALE calibrates the raw per-card values so a median 12-card hand
// estimates ~6.5 tricks (empirically tuned over random deals).
const EST_SCALE = 1.66;

function estimateForTrump(hand, trump) {
  const contract = { type: 'suit', trump };
  let est = 0;
  for (const c of hand) {
    const es = effectiveSuit(c, contract);
    if (es === trump) {
      if (c.rank === 'J' && c.suit === trump) est += 0.95; // right bower
      else if (c.rank === 'J' && sameColor(c.suit, trump)) est += 0.9; // left bower
      else if (c.rank === 'A') est += 0.8;
      else if (c.rank === 'K') est += 0.55;
      else if (c.rank === 'Q') est += 0.35;
      else if (c.rank === '10') est += 0.15;
      else est += 0.05;
    } else if (c.rank === 'A') est += 0.55;
    else if (c.rank === 'K') est += 0.22;
    else if (c.rank === 'Q') est += 0.1;
    else if (c.rank === 'J') est += 0.06;
    else est += 0.02;
  }
  return est * EST_SCALE;
}

function bestTrump(hand) {
  let best = SUITS[0], bestEst = -1;
  for (const s of SUITS) {
    const e = estimateForTrump(hand, s);
    if (e > bestEst) { bestEst = e; best = s; }
  }
  return { trump: best, est: bestEst };
}

function chooseBid(game, seat) {
  const valid = game.validBids();
  if (!valid.length) return 'pass';
  const low = valid[0];
  const { est } = bestTrump(game.hands[seat]);
  // hussy only with a near-perfect hand
  let target = est >= 11.5 ? MAX_BID : Math.floor(est + (Math.random() * 0.8 - 0.4));
  if (target < 6) return 'pass';
  if (target > MAX_BID) target = MAX_BID;
  if (target < low) return 'pass';
  // don't leap straight to a hussy unless the hand truly demands it
  if (target === MAX_BID && est < 11.5) target = Math.min(11, Math.max(low, 11));
  if (target < low) return 'pass';
  // occasional aggression
  if (target < MAX_BID && Math.random() < 0.1 && valid.includes(target + 1)) target++;
  return valid.includes(target) ? target : low;
}

function chooseTrump(game, seat) {
  const hand = game.hands[seat];
  const hussy = game.bidding.high && game.bidding.high.amount === MAX_BID;
  const { trump, est } = bestTrump(hand);
  if (hussy) {
    // go High (no trump) only with aces everywhere
    const aces = hand.filter((c) => c.rank === 'A').length;
    if (aces >= 5) return 'HIGH';
  }
  return trump;
}

function chooseCard(game, seat) {
  const hand = game.hands[seat];
  const contract = game.contract;
  const trick = game.trick;
  const pow = (c, led) => cardPower(c, contract, led);

  if (!trick.length) {
    // leading: play the strongest card
    let best = hand[0], bestPow = -1;
    for (const c of hand) {
      const p = pow(c, effectiveSuit(c, contract));
      if (p > bestPow) { bestPow = p; best = c; }
    }
    return best.id;
  }

  const ledSuit = effectiveSuit(trick[0].card, contract);
  const legal = legalCards(hand, contract, ledSuit);
  const winner = trickWinner(trick, contract);

  const minOf = (cards) => cards.reduce((a, b) => (pow(a, ledSuit) <= pow(b, ledSuit) ? a : b));

  if (teamOf(winner) === teamOf(seat)) {
    // partner is winning: don't waste anything good
    return minOf(legal).id;
  }
  const bestPow = Math.max(...trick.map((p) => pow(p.card, ledSuit)));
  const winners = legal.filter((c) => pow(c, ledSuit) > bestPow);
  if (winners.length) return minOf(winners).id; // cheapest card that takes it
  return minOf(legal).id; // can't win: throw the lowest
}

module.exports = { chooseBid, chooseTrump, chooseCard, estimateForTrump, bestTrump };
