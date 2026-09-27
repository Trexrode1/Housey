// Double-Bid Euchre engine — Tim's house rules.
// 4 players, 2 teams (seats 0&2 vs 1&3), 48-card double deck (two copies of 9-A).
// 12 cards each, 12 tricks. Min bid 6. Bid of 12 = HUSSY (take all 12 tricks):
//   made => +24, set => -12. No-trump ("High") may only be named on a hussy.
// Normal contract: makers score 1/trick taken if bid made, else -bid.
// Defenders always score 1/trick taken. First team to 62 wins.

const SUITS = ['S', 'H', 'D', 'C'];
const RANKS = ['9', '10', 'J', 'Q', 'K', 'A'];
const RANK_VAL = { '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };
const SUIT_GLYPH = { S: '♠', H: '♥', D: '♦', C: '♣' };
const RED = new Set(['H', 'D']);

const MIN_BID = 6;
const MAX_BID = 12; // == HUSSY
const TRICKS_PER_HAND = 12;
const WIN_SCORE = 62;

const teamOf = (seat) => seat % 2;
const sameColor = (a, b) => RED.has(a) === RED.has(b);

function buildDeck() {
  const d = [];
  for (const s of SUITS)
    for (const r of RANKS)
      for (const c of [1, 2]) d.push({ id: `${r}${s}${c}`, rank: r, suit: s, copy: c });
  return d;
}

function shuffle(deck, rand = Math.random) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// contract: { type: 'suit'|'high', trump: 'S'|'H'|'D'|'C'|null }
function effectiveSuit(card, contract) {
  if (contract && contract.type === 'suit' && card.rank === 'J') {
    if (card.suit === contract.trump) return contract.trump; // right bower
    if (sameColor(card.suit, contract.trump)) return contract.trump; // left bower
  }
  return card.suit;
}
const isRightBower = (card, c) => c.type === 'suit' && card.rank === 'J' && card.suit === c.trump;
const isLeftBower = (card, c) =>
  c.type === 'suit' && card.rank === 'J' && card.suit !== c.trump && sameColor(card.suit, c.trump);

function cardPower(card, contract, ledSuit) {
  const es = effectiveSuit(card, contract);
  if (contract.type === 'suit' && es === contract.trump) {
    if (isRightBower(card, contract)) return 200;
    if (isLeftBower(card, contract)) return 190;
    return 100 + RANK_VAL[card.rank];
  }
  if (es === ledSuit) return RANK_VAL[card.rank];
  return 0;
}

// plays: [{seat, card}] in play order. First-played wins ties between identical cards.
function trickWinner(plays, contract) {
  const led = effectiveSuit(plays[0].card, contract);
  let best = plays[0];
  let bestPow = cardPower(best.card, contract, led);
  for (let i = 1; i < plays.length; i++) {
    const p = cardPower(plays[i].card, contract, led);
    if (p > bestPow) {
      best = plays[i];
      bestPow = p;
    }
  }
  return best.seat;
}

function legalCards(hand, contract, ledSuit) {
  if (!ledSuit) return hand.slice();
  const follow = hand.filter((c) => effectiveSuit(c, contract) === ledSuit);
  return follow.length ? follow : hand.slice();
}

function sortHand(hand, contract) {
  const suitOrder = (s) => {
    if (contract && contract.type === 'suit') {
      if (s === contract.trump) return 0;
    }
    return 1 + SUITS.indexOf(s);
  };
  return hand.slice().sort((a, b) => {
    const sa = effectiveSuit(a, contract), sb = effectiveSuit(b, contract);
    if (suitOrder(sa) !== suitOrder(sb)) return suitOrder(sa) - suitOrder(sb);
    return RANK_VAL[b.rank] - RANK_VAL[a.rank];
  });
}

class Game {
  constructor(names) {
    this.names = names.slice(0, 4);
    this.scores = [0, 0];
    this.dealer = 0;
    this.handNo = 0;
    this.winner = null;
    this.startHand();
  }

  startHand() {
    this.handNo++;
    const deck = shuffle(buildDeck());
    this.hands = [[], [], [], []];
    for (let i = 0; i < deck.length; i++) this.hands[i % 4].push(deck[i]);
    this.phase = 'bidding';
    this.bidding = { high: null, passes: 0, turn: (this.dealer + 1) % 4, log: [] };
    this.turn = this.bidding.turn;
    this.contract = null;
    this.trick = [];
    this.lastTrick = null;
    this.leader = null;
    this.tricksWon = [0, 0];
    this.lastResult = null;
    this.message = `${this.names[this.bidding.turn]} opens the bidding (min ${MIN_BID})`;
  }

  validBids() {
    const low = this.bidding.high ? this.bidding.high.amount + 1 : MIN_BID;
    const bids = [];
    for (let b = low; b <= MAX_BID; b++) bids.push(b);
    return bids;
  }

  bid(seat, amount) {
    // amount: number 6..12, or 'pass'
    if (this.phase !== 'bidding') throw new Error('Bidding is over');
    if (seat !== this.bidding.turn) throw new Error("It's not your turn to bid");
    if (amount === 'pass') {
      this.bidding.log.push({ seat, bid: 'pass' });
      this.bidding.passes++;
      this.message = `${this.names[seat]} passes`;
    } else {
      const low = this.bidding.high ? this.bidding.high.amount + 1 : MIN_BID;
      if (!Number.isInteger(amount) || amount < low || amount > MAX_BID)
        throw new Error(`Bid must be ${low}–${MAX_BID}`);
      this.bidding.high = { seat, amount };
      this.bidding.passes = 0;
      this.bidding.log.push({ seat, bid: amount });
      this.message =
        amount === MAX_BID
          ? `${this.names[seat]} bids HUSSY (all ${TRICKS_PER_HAND})!`
          : `${this.names[seat]} bids ${amount}`;
    }

    if (this.bidding.high && this.bidding.passes >= 3) {
      this.phase = 'naming';
      this.turn = this.bidding.high.seat;
      this.message = `${this.names[this.turn]} won the bid — name trump`;
    } else if (!this.bidding.high && this.bidding.passes >= 4) {
      this.dealer = (this.dealer + 1) % 4;
      this.startHand();
      this.message = 'Everyone passed — redeal';
    } else {
      this.bidding.turn = (this.bidding.turn + 1) % 4;
      this.turn = this.bidding.turn;
    }
  }

  nameTrump(seat, trump) {
    // trump: 'S'|'H'|'D'|'C' | 'HIGH' (HIGH only legal on a hussy)
    if (this.phase !== 'naming') throw new Error('Not naming trump right now');
    if (seat !== this.bidding.high.seat) throw new Error('Only the bidder names trump');
    const hussy = this.bidding.high.amount === MAX_BID;
    if (trump === 'HIGH' && !hussy) throw new Error('No-trump ("High") is only allowed on a hussy bid');
    if (trump !== 'HIGH' && !SUITS.includes(trump)) throw new Error('Pick a suit');
    this.contract = {
      bidder: seat,
      amount: this.bidding.high.amount,
      hussy,
      type: trump === 'HIGH' ? 'high' : 'suit',
      trump: trump === 'HIGH' ? null : trump,
    };
    this.phase = 'playing';
    this.leader = seat;
    this.turn = seat;
    this.trick = [];
    const t = trump === 'HIGH' ? 'High (no trump)' : `${SUIT_GLYPH[trump]} trump`;
    this.message = hussy
      ? `${this.names[seat]} goes HUSSY — ${t}, must take all ${TRICKS_PER_HAND}`
      : `${this.names[seat]} names ${t} — needs ${this.contract.amount} tricks`;
  }

  play(seat, cardId) {
    if (this.phase !== 'playing') throw new Error('Not playing right now');
    if (seat !== this.turn) throw new Error("It's not your turn");
    if (this.trick.length === 4) throw new Error("Waiting for trick to clear");
    const hand = this.hands[seat];
    const idx = hand.findIndex((c) => c.id === cardId);
    if (idx < 0) throw new Error("You don't hold that card");
    const ledSuit = this.trick.length ? effectiveSuit(this.trick[0].card, this.contract) : null;
    const legal = legalCards(hand, this.contract, ledSuit);
    const card = hand[idx];
    if (!legal.includes(card)) throw new Error('You must follow suit');
    hand.splice(idx, 1);
    this.trick.push({ seat, card });

    if (this.trick.length === 4) {
      const w = trickWinner(this.trick, this.contract);
      this.tricksWon[teamOf(w)]++;
      this.lastTrick = { plays: this.trick, winner: w };
      this.leader = w;
      this.turn = w;
      this.message = `${this.names[w]} takes the trick`;
    } else {
      this.turn = (this.turn + 1) % 4;
    }
  }

  clearTrick() {
    this.trick = [];
    if (this.hands[0].length === 0) this.finishHand();
  }
  finishHand() {
    const b = this.contract.bidder;
    const makers = teamOf(b), defenders = 1 - makers;
    const mt = this.tricksWon[makers], dt = this.tricksWon[defenders];
    let detail;
    if (this.contract.hussy) {
      if (mt === TRICKS_PER_HAND) {
        this.scores[makers] += 24;
        detail = `HUSSY MADE! +24`;
      } else {
        this.scores[makers] -= 12;
        detail = `Hussy set! −12`;
      }
      this.scores[defenders] += dt;
    } else {
      if (mt >= this.contract.amount) {
        this.scores[makers] += mt;
        detail = `Bid made: +${mt}`;
      } else {
        this.scores[makers] -= this.contract.amount;
        detail = `Set! −${this.contract.amount}`;
      }
      this.scores[defenders] += dt;
    }
    this.lastResult = {
      bidder: this.names[b],
      amount: this.contract.amount,
      hussy: this.contract.hussy,
      makersTricks: mt,
      defendersTricks: dt,
      detail,
      scores: this.scores.slice(),
    };
    this.message = detail;
    this.phase = 'handEnd';
    const [s0, s1] = this.scores;
    if ((s0 >= WIN_SCORE || s1 >= WIN_SCORE) && s0 !== s1) {
      this.phase = 'gameOver';
      this.winner = s0 > s1 ? 0 : 1;
    }
  }

  nextHand() {
    if (this.phase !== 'handEnd') throw new Error('Hand is not over yet');
    this.dealer = (this.dealer + 1) % 4;
    this.startHand();
  }

  resetMatch() {
    this.scores = [0, 0];
    this.winner = null;
    this.dealer = (this.dealer + 1) % 4;
    this.startHand();
  }

  stateFor(seat) {
    const c = this.contract;
    return {
      phase: this.phase,
      handNo: this.handNo,
      names: this.names.slice(),
      scores: this.scores.slice(),
      winner: this.winner,
      dealer: this.dealer,
      turn: this.turn,
      bid: this.bidding.high
        ? { seat: this.bidding.high.seat, amount: this.bidding.high.amount, by: this.names[this.bidding.high.seat] }
        : null,
      bidLog: this.bidding.log.map((e) => ({ name: this.names[e.seat], bid: e.bid })),
      validBids: this.phase === 'bidding' && this.bidding.turn === seat ? this.validBids() : [],
      canGoHigh: this.phase === 'naming' && this.bidding.high.amount === MAX_BID,
      contract: c
        ? {
            bidder: c.bidder, bidderName: this.names[c.bidder], amount: c.amount,
            hussy: c.hussy, type: c.type, trump: c.trump,
            makers: teamOf(c.bidder),
          }
        : null,
      trick: this.trick.map((p) => ({ seat: p.seat, name: this.names[p.seat], card: p.card })),
      leader: this.leader,
      lastTrick: this.lastTrick
        ? { plays: this.lastTrick.plays.map((p) => ({ seat: p.seat, name: this.names[p.seat], card: p.card })), winner: this.lastTrick.winner, winnerName: this.names[this.lastTrick.winner] }
        : null,
      tricksWon: this.tricksWon.slice(),
      handCounts: this.hands.map((h) => h.length),
      hand: sortHand(this.hands[seat], this.contract),
      lastResult: this.lastResult,
      message: this.message,
    };
  }
}

module.exports = {
  Game, buildDeck, shuffle, effectiveSuit, trickWinner, legalCards, cardPower, sortHand,
  SUITS, RANKS, RANK_VAL, SUIT_GLYPH, MIN_BID, MAX_BID, TRICKS_PER_HAND, WIN_SCORE, teamOf,
};
