// ============================================================================
//  SASE Market Game — GAME DATA
// ----------------------------------------------------------------------------
//  This is the ONLY file you need to edit to change the game's content.
//  Everything here is plain data — no coding required to tweak it.
//
//  HOW IT WORKS:
//   - STARTING_CASH: every team begins with this hypothetical money.
//   - STOCKS: the 4 companies teams can invest in. Prices here are the
//     STARTING prices for Round 1. The game updates them each round using
//     the "moves" you define below.
//   - ROUNDS: each round = one financial "quarter." Teams read the scenario,
//     decide how to allocate across the stocks, then the host reveals and
//     each stock changes by the percent in that round's "moves".
//
//  TO EDIT: change any text or number. To ADD a round, copy a round block
//  and paste it into the ROUNDS array. To add a stock, add it to STOCKS AND
//  add a matching entry in every round's "moves". Keep stock "id" values
//  consistent everywhere.
// ============================================================================

export const STARTING_CASH = 10000;

// The four companies. Each is a different SECTOR on purpose — that way
// "put everything in one stock" is a losing strategy and diversification
// becomes the lesson. Keep ids short and lowercase; they're used as keys.
export const STOCKS = [
  {
    id: "tetra",
    name: "Tetra Robotics",
    ticker: "TTRA",
    sector: "Tech / Hardware",
    startPrice: 100,
    blurb: "A buzzy robotics startup. High growth, high drama — swings hard both ways.",
  },
  {
    id: "verde",
    name: "Verde Energy",
    ticker: "VRDE",
    sector: "Energy",
    startPrice: 60,
    blurb: "A renewable-energy company. Sensitive to regulation and oil prices.",
  },
  {
    id: "harvest",
    name: "Harvest Foods",
    ticker: "HRVS",
    sector: "Consumer Staples",
    startPrice: 40,
    blurb: "A boring grocery brand. People eat in good times and bad — steady, low drama.",
  },
  {
    id: "meridian",
    name: "Meridian Bank",
    ticker: "MRDN",
    sector: "Finance",
    startPrice: 80,
    blurb: "A regional bank. Loves high interest rates, hates uncertainty.",
  },
];

// ----------------------------------------------------------------------------
//  THE ROUNDS
//  Each round has:
//    title       — short name shown on screen
//    quarter     — flavor label (Q1, Q2, ...)
//    headline    — the big scenario line teams react to
//    detail      — 1–2 sentences of extra context / hints (honest but not obvious)
//    moves       — percent change for EACH stock id this round (e.g. 15 = +15%, -20 = -20%)
//    debrief     — the "why," read aloud by you or an AIC facilitator AFTER the reveal.
//                  This is the actual lesson. Edit these to match your teaching points.
//
//  DESIGN NOTE (delete if you like): the moves are tuned so no single stock
//  always wins, the middle rounds punish over-concentration, and Round 6 is a
//  curveball that rewards teams who diversified or kept some cash. Re-balance
//  freely — just keep at least one "boring stock does fine while exciting stock
//  crashes" round so diversification pays off.
// ----------------------------------------------------------------------------

export const ROUNDS = [
  {
    title: "The Bull Run",
    quarter: "Q1",
    headline: "Markets open hot. Optimism everywhere and money is cheap.",
    detail:
      "A strong economy lifts almost everything — but the high-growth names climb fastest. The safe, boring stocks barely move.",
    moves: { tetra: 18, verde: 10, harvest: 3, meridian: 8 },
    debrief:
      "In a broad rally, growth/tech tends to outpace defensive stocks. Teams that chased Tetra look like geniuses right now — remember that feeling, it sets up Round 3. Steady names like Harvest underperform in a boom; that's normal, their value shows up later.",
  },
  {
    title: "Rate Hike",
    quarter: "Q2",
    headline: "The Federal Reserve raises interest rates to cool inflation.",
    detail:
      "Higher rates are good news for banks (they earn more on loans) but they make risky, unprofitable growth stocks less attractive. Energy is mixed.",
    moves: { tetra: -12, verde: -3, harvest: 4, meridian: 11 },
    debrief:
      "Interest rates move sectors in opposite directions. Banks (Meridian) profit from higher rates; speculative tech (Tetra) gets repriced down because future profits are worth less today. This is why understanding WHY you own something matters more than the hype.",
  },
  {
    title: "The Hype Bubble Pops",
    quarter: "Q3",
    headline: "Tetra Robotics misses earnings badly. The hype was overdone.",
    detail:
      "The market's favorite stock disappoints. Anyone heavily concentrated in one exciting name is about to learn a lesson. Defensive stocks hold up.",
    moves: { tetra: -35, verde: 5, harvest: 6, meridian: 2 },
    debrief:
      "THE diversification lesson. Teams that went all-in on Tetra after Round 1 just got wrecked; teams that spread out barely felt it. This is the single most important idea in the game: concentration magnifies BOTH directions, and you rarely know which is coming. Harvest, the 'boring' stock, is quietly winning the long game.",
  },
  {
    title: "Regulation Shake-Up",
    quarter: "Q4",
    headline: "New government subsidies pass for clean energy.",
    detail:
      "A policy change can create a winner overnight. Verde benefits directly. Watch how a single headline reshapes one sector without touching the others much.",
    moves: { tetra: 6, verde: 28, harvest: 1, meridian: -4 },
    debrief:
      "External events — policy, regulation, geopolitics — can matter more than a company's own performance. You can't predict these, which is the point: diversification isn't about picking winners, it's about not getting destroyed by the thing you didn't see coming.",
  },
  {
    title: "Recession Fears",
    quarter: "Q5",
    headline: "Economic data weakens. Investors get nervous and defensive.",
    detail:
      "When fear rises, money flows OUT of risky stocks and INTO safe, stable ones. The boring stock everyone ignored becomes the hero. Cash starts looking smart too.",
    moves: { tetra: -20, verde: -15, harvest: 10, meridian: -8 },
    debrief:
      "This is Harvest's moment — defensive 'staples' hold value when everything else drops, because people buy groceries in any economy. Teams holding some cash also avoided the bleeding. Note the reversal from Round 1: the leaders and laggards completely flipped.",
  },
  {
    title: "The Curveball",
    quarter: "Q6 — FINAL",
    headline: "Surprise! A buyout rumor sends ONE stock soaring — but which?",
    detail:
      "Final round, highest stakes. There's no way to have known this was coming — it rewards teams who stayed diversified or kept some cash to react. Lock in your final positions!",
    moves: { tetra: 25, verde: -10, harvest: 8, meridian: 18 },
    debrief:
      "The closing lesson: you cannot predict everything, and the final 'right answer' was partly luck. Over six rounds, though, the teams near the top are almost always the ones who diversified and reasoned about WHY, not the ones who gambled on one name. That's the whole game — manage uncertainty, don't try to eliminate it.",
  },
];

// ----------------------------------------------------------------------------
//  OPTIONAL TUNING KNOBS (safe to ignore for a first build)
// ----------------------------------------------------------------------------
export const CONFIG = {
  roundTimerSeconds: 60,   // how long teams have to decide each round
  allowCash: true,         // can teams keep uninvested cash? (recommended: true)
  showSectorsToPlayers: true, // show each stock's sector on phones (teaching aid)
};