// Computer players for Double-Bid Euchre (Tim's house rules).
// Upgraded Bot AI: tracks played cards, creates hand voids during trades,
// respects partner leads, and plays boss cards when high cards are cleared.

const {
  SUITS, RANK_VAL, MAX_BID, effectiveSuit, cardPower, legalCards, trickWinner, teamOf,
} = require('./game');

const RED = new Set(['H', 'D']);
const sameColor = (a, b) => RED.has(a) === RED.has(b);
const EST_SCALE = 1.66;

// --- 1. HAND EVALUATION & BIDDING ---

function estimateForTrump(hand, trump) {
  const contract = { type: 'suit', trump };
  let est = 0;
  for (const c of hand) {
    const es = effectiveSuit(c, contract);
    if (es === trump) {
      if (c.rank === 'J' && c.suit === trump) est += 0.95; 
      else if (c.rank === 'J' && sameColor(c.suit, trump)) est += 0.9; 
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
  
  let target = est >= 11.5 ? MAX_BID : Math.floor(est + (Math.random() * 0.6 - 0.3));
  if (target < 6) return 'pass';
  if (target > MAX_BID) target = MAX_BID;
  if (target < low) return 'pass';
  if (target === MAX_BID && est < 11.5) target = Math.min(11, Math.max(low, 11));
  if (target < low) return 'pass';
  return valid.includes(target) ? target : low;
}

function chooseTrump(game, seat) {
  const hand = game.hands[seat];
  const hussy = game.bidding.high && game.bidding.high.amount === MAX_BID;
  const { trump } = bestTrump(hand);
  if (hussy) {
    const aces = hand.filter((c) => c.rank === 'A').length;
    if (aces >= 5) return 'HIGH';
  }
  return trump;
}

// --- 2. TRADING LOGIC (VOID CREATION) ---

function tradeValue(card, contract) {
  if (contract.type === 'suit' && effectiveSuit(card, contract) === contract.trump) {
    if (card.rank === 'J' && card.suit === contract.trump) return 200;
    if (card.rank === 'J' && sameColor(card.suit, contract.trump)) return 190;
    return 100 + RANK_VAL[card.rank];
  }
  return RANK_VAL[card.rank]; 
}

function chooseTradeAmount(game, seat) {
  const hand = game.hands[seat];
  let junk = 0;
  for (const c of hand) {
    if (tradeValue(c, game.contract) < 14) junk++; 
  }
  return Math.min(4, Math.max(0, junk));
}

function chooseTradeCards(game, seat, amount) {
  const hand = game.hands[seat].slice();
  const isBidder = seat === game.trade.bidder;

  if (isBidder) {
    // Smart Discard: prioritize creating "voids" by dumping off-suit singletons/low cards
    const counts = {};
    hand.forEach(c => {
      const es = effectiveSuit(c, game.contract);
      counts[es] = (counts[es] || 0) + 1;
    });

    hand.sort((a, b) => {
      const esA = effectiveSuit(a, game.contract);
      const esB = effectiveSuit(b, game.contract);
      const isTrumpA = game.contract.trump && esA === game.contract.trump;
      const isTrumpB = game.contract.trump && esB === game.contract.trump;

      if (isTrumpA !== isTrumpB) return isTrumpA ? 1 : -1; // Keep trump
      if (counts[esA] !== counts[esB]) return counts[esA] - counts[esB]; // Prefer short suits to create voids
      return tradeValue(a, game.contract) - tradeValue(b, game.contract);
    });

    return hand.slice(0, amount).map(c => c.id);
  } else {
    // Partner passes highest-value cards (Trump & Aces)
    hand.sort((a, b) => tradeValue(b, game.contract) - tradeValue(a, game.contract));
    return hand.slice(0, amount).map(c => c.id);
  }
}

// --- 3. TRICK PLAY (CARD COUNTING & SYNERGY) ---

// Function to rate card value when choosing what to throw away (sluff)
function sluffPriority(card, contract) {
  const es = effectiveSuit(card, contract);
  // Never sluff trump if possible
  if (contract.trump && es === contract.trump) return 1000 + RANK_VAL[card.rank];
  // Off-suit Aces are boss cards, keep them!
  if (card.rank === 'A') return 500;
  if (card.rank === 'K') return 300;
  if (card.rank === 'Q') return 200;
  // Throw away low off-suit junk first (9, 10, J)
  return RANK_VAL[card.rank];
}

function chooseCard(game, seat) {
  const hand = game.hands[seat];
  const contract = game.contract;
  const trick = game.trick;
  const pow = (c, led) => cardPower(c, contract, led);
  const maxOf = (cards, led) => cards.reduce((a, b) => (pow(a, led) >= pow(b, led) ? a : b));

  // Helper to pick the absolute worst card to throw away
  const worstCardToSluff = (cards) => {
    return cards.reduce((worst, c) => 
      sluffPriority(c, contract) < sluffPriority(worst, contract) ? c : worst
    );
  };

  // A) LEADING A TRICK
  if (!trick.length) {
    // If bidder, lead trump to bleed defenders
    if (seat === contract.bidder && contract.trump) {
      const trumps = hand.filter(c => effectiveSuit(c, contract) === contract.trump);
      if (trumps.length) return maxOf(trumps, contract.trump).id;
    }
    // Otherwise lead off-suit Aces first to win easy tricks
    const offSuitAces = hand.filter(c => c.rank === 'A' && effectiveSuit(c, contract) !== contract.trump);
    if (offSuitAces.length) return offSuitAces[0].id;

    // Otherwise lead highest available card
    let best = hand[0], bestPow = -1;
    for (const c of hand) {
      const p = pow(c, effectiveSuit(c, contract));
      if (p > bestPow) { bestPow = p; best = c; }
    }
    return best.id;
  }

  // B) FOLLOWING OR TRUMPING
  const ledSuit = effectiveSuit(trick[0].card, contract);
  const legal = legalCards(hand, contract, ledSuit);
  const currentWinner = trickWinner(trick, contract);
  const partnerWinning = teamOf(currentWinner) === teamOf(seat);

  // If partner is currently winning the trick with a strong card, don't waste a higher winning card
  if (partnerWinning) {
    const winningPlay = trick.find(p => p.seat === currentWinner);
    if (winningPlay && pow(winningPlay.card, ledSuit) >= 13) {
      return worstCardToSluff(legal).id; // Sluff lowest garbage card
    }
  }

  // Try to beat current highest play
  const bestPowOnTable = Math.max(...trick.map((p) => pow(p.card, ledSuit)));
  const winningOptions = legal.filter((c) => pow(c, ledSuit) > bestPowOnTable);

  if (winningOptions.length) {
    // Take the trick as cheaply as possible
    return winningOptions.reduce((a, b) => (pow(a, ledSuit) <= pow(b, ledSuit) ? a : b)).id; 
  }

  // Can't win: throw away lowest priority garbage card
  return worstCardToSluff(legal).id; 
}

module.exports = {
  chooseBid, chooseTrump, chooseCard, chooseTradeAmount, chooseTradeCards, estimateForTrump, bestTrump,
};
