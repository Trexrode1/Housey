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

function effectiveSuit(card, contract) {
  if (contract && contract.type === 'suit' && card.rank === 'J') {
    if (card.suit === contract.trump) return contract.trump; 
    if (sameColor(card.suit, contract.trump)) return contract.trump; 
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
    this.trade = null;
    this.message = `${this.names[this.bidding.turn]} opens the bidding (min ${MIN_BID})`;
  }

  validBids() {
    const low = this.bidding.high ? this.bidding.high.amount + 1 : MIN_BID;
    const bids = [];
    for (let b = low; b <= MAX_BID; b++) bids.push(b);
    return bids;
  }

  bid(seat, amount) {
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
          ? `${this.names[seat]} bids HOUSEY (all ${TRICKS_PER_HAND})!`
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
    
    const t = trump === 'HIGH' ? 'High (no trump)' : `${SUIT_GLYPH[trump]} trump`;
    
    if (hussy) {
      this.phase = 'trading';
      this.trade = {
        amount: null,
        bidder: seat,
        partner: (seat + 2) % 4,
        bidderCards: null,
        partnerCards: null
      };
      this.message = `${this.names[seat]} goes HOUSEY on ${t}! How many cards to trade?`;
    } else {
      this.phase = 'playing';
      this.leader = seat;
      this.turn = seat;
      this.trick = [];
      this.message = `${this.names[seat]} names ${t} — needs ${this.contract.amount} tricks`;
    }
  }

  setTradeAmount(seat, amount) {
    if (this.phase !== 'trading' || seat !== this.trade.bidder) throw new Error("Invalid trade action");
    if (amount < 0 || amount > 4) throw new Error("Trade 0 to 4 cards");
    this.trade.amount = amount;
    
    if (amount === 0) {
      this.contract.bigHousey = true;
      this.phase = 'playing';
      this.leader = this.trade.bidder;
      this.turn = this.trade.bidder;
      this.trick = [];
      this.message = `${this.names[seat]} goes BIG HOUSEY (0 card trade)!`;
    } else {
      this.message = `${this.names[seat]} is trading ${amount} cards blindly.`;
    }
  }
  tradeCards(seat, cardIds) {
    if (this.phase !== 'trading' || this.trade.amount === null) throw new Error("Not trading cards yet");
    if (cardIds.length !== this.trade.amount) throw new Error(`Select exactly ${this.trade.amount} cards`);

    const hand = this.hands[seat];
    for (const id of cardIds) {
      if (!hand.some(c => c.id === id)) throw new Error("You don't hold that card");
    }

    if (seat === this.trade.bidder) this.trade.bidderCards = cardIds;
    else if (seat === this.trade.partner) this.trade.partnerCards = cardIds;
    else throw new Error("You are not part of the trade");

    if (this.trade.bidderCards && this.trade.partnerCards) {
      const bHand = this.hands[this.trade.bidder];
      const pHand = this.hands[this.trade.partner];

      const bGive = this.trade.bidderCards.map(id => bHand.find(c => c.id === id));
      const pGive = this.trade.partnerCards.map(id => pHand.find(c => c.id === id));

      this.hands[this.trade.bidder] = bHand.filter(c => !this.trade.bidderCards.includes(c.id));
      this.hands[this.trade.partner] = pHand.filter(c => !this.trade.partnerCards.includes(c.id));

      this.hands[this.trade.bidder].push(...pGive);
      this.hands[this.trade.partner].push(...bGive);

      this.phase = 'playing';
      this.leader = this.trade.bidder;
      this.turn = this.trade.bidder;
      this.trick = [];
      this.message = `${this.names[this.trade.bidder]} begins the HOUSEY!`;
    }
  }

  play(seat, cardId) {
    if (this.phase !== 'playing') throw new Error('Not playing right now');
    if (seat !== this.turn) throw new Error("It's not your turn");
    const targetSize = this.contract.hussy ? 3 : 4;
    if (this.trick.length === targetSize) throw new Error("Waiting for trick to clear");
    if (this.contract.hussy && seat === (this.contract.bidder + 2) % 4) throw new Error("Partner sits out on a Housey");
    
    const hand = this.hands[seat];
    const idx = hand.findIndex((c) => c.id === cardId);
    if (idx < 0) throw new Error("You don't hold that card");
    const ledSuit = this.trick.length ? effectiveSuit(this.trick[0].card, this.contract) : null;
    const legal = legalCards(hand, this.contract, ledSuit);
    const card = hand[idx];
    if (!legal.includes(card)) throw new Error('You must follow suit');
    hand.splice(idx, 1);
    this.trick.push({ seat, card });

    if (this.trick.length === targetSize) {
      const w = trickWinner(this.trick, this.contract);
      this.message = `${this.names[w]} takes the trick`;
    } else {
      do {
        this.turn = (this.turn + 1) % 4;
      } while (this.contract.hussy && this.turn === (this.contract.bidder + 2) % 4);
    }
  }

  clearTrick() {
    const targetSize = this.contract.hussy ? 3 : 4;
    if (this.trick.length !== targetSize) return;
    const w = trickWinner(this.trick, this.contract);
    this.tricksWon[teamOf(w)]++;
    this.lastTrick = { plays: this.trick, winner: w }; 
    this.leader = w;
    this.turn = w;
    this.trick = [];
    if (this.hands[this.leader].length === 0) this.finishHand();
  }

  finishHand() {
    const b = this.contract.bidder;
    const makers = teamOf(b), defenders = 1 - makers;
    const mt = this.tricksWon[makers], dt = this.tricksWon[defenders];
    let detail;
   if (this.contract.hussy) {
      if (this.contract.bigHousey) {
        if (mt === TRICKS_PER_HAND) {
          this.scores[makers] += 48;
          detail = `BIG HOUSEY MADE! +48`;
        } else {
          this.scores[makers] -= 24;
          detail = `BIG HOUSEY set! −24`;
        }
      } else {
        if (mt === TRICKS_PER_HAND) {
          this.scores[makers] += 24;
          detail = `HOUSEY MADE! +24`;
        } else {
          this.scores[makers] -= 12;
          detail = `HOUSEY set! −12`;
        }
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
            hussy: c.hussy, bigHousey: c.bigHousey || false, type: c.type, trump: c.trump,
            makers: teamOf(c.bidder),
          }
        : null,
      trade: this.phase === 'trading' && this.trade ? {
        amount: this.trade.amount,
        bidder: this.trade.bidder,
        partner: this.trade.partner,
        bidderReady: !!this.trade.bidderCards,
        partnerReady: !!this.trade.partnerCards,
      } : null,
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
