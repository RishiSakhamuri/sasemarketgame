// ============================================================================
//  HOST LOGIC — the "game brain"
// ----------------------------------------------------------------------------
//  Responsibilities:
//   1. Create a room (a short code) in the Realtime Database.
//   2. Show teams as they join (the lobby).
//   3. Run each round: scenario + 60s timer; show who has locked in.
//   4. On "Reveal", apply that round's percent moves to every team's holdings,
//      recompute portfolio values, and show a leaderboard.
//   5. After the last round, show a final ranking.
//
//  The host is the ONLY screen that writes prices / values / game state.
//  Players only ever write their OWN team's choice. This keeps the math in
//  one place and avoids cheating.
// ============================================================================

// --- Firebase modular SDK (loaded straight from Google's CDN, no install) ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getDatabase, ref, set, update, get, onValue, onDisconnect, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// --- Our own files ---
import { firebaseConfig } from "./firebase-config.js";
import { STOCKS, ROUNDS, STARTING_CASH, CONFIG } from "./game-data.js";

// ----------------------------------------------------------------------------
//  Set up Firebase
// ----------------------------------------------------------------------------
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// ----------------------------------------------------------------------------
//  Tiny helpers
// ----------------------------------------------------------------------------
// Grab an element by id (shorter to type).
const $ = (id) => document.getElementById(id);

// Format a number as US dollars, e.g. 10523.4 -> "$10,523.40".
const money = (n) =>
  "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Format a percent move with a sign, e.g. 18 -> "+18%", -35 -> "-35%".
const pct = (n) => (n >= 0 ? "+" : "") + n + "%";

// Make a short, easy-to-read room code (no easily-confused chars like O/0/I/1).
function makeRoomCode() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// Build the starting prices object from STOCKS, e.g. { tetra: 100, verde: 60, ... }.
function startingPrices() {
  const prices = {};
  for (const s of STOCKS) prices[s.id] = s.startPrice;
  return prices;
}

// Price history per stock, e.g. { tetra: [100], verde: [60], ... }. We append
// the new price each reveal so the projector can draw a little sparkline.
function startingHistory() {
  const hist = {};
  for (const s of STOCKS) hist[s.id] = [s.startPrice];
  return hist;
}

// Show exactly one phase <section> and hide the others.
function showPhase(name) {
  for (const el of document.querySelectorAll(".phase")) el.classList.add("hidden");
  $("phase-" + name).classList.remove("hidden");
}

// ----------------------------------------------------------------------------
//  Game state we keep in memory on the host (mirrors the DB)
// ----------------------------------------------------------------------------
let roomCode = null;     // e.g. "TXKP"
let roomRef = null;      // shortcut: ref(db, "rooms/TXKP")
let teams = {};          // { teamId: {name, cash, shares, value, locked, ...} }
let prices = {};         // current stock prices { tetra: 100, ... }
let priceHistory = {};   // price per stock over time, for sparklines
let roundIndex = -1;     // which round we're on (-1 = lobby)
let roundOrder = [];     // which scenarios (and order) this game uses, e.g. [3,0,5,1,4,2]
let timerInterval = null;

// Randomly shuffle an array in place (Fisher–Yates) and return it.
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// The scenario object for the round we're currently on. We don't use
// ROUNDS[roundIndex] directly anymore — roundOrder maps the game's round
// number to a (possibly random) scenario in game-data.js.
function roundData() {
  return ROUNDS[roundOrder[roundIndex]];
}

// ----------------------------------------------------------------------------
//  1. CREATE THE ROOM (runs as soon as the host page loads)
// ----------------------------------------------------------------------------
async function createRoom() {
  roomCode = makeRoomCode();
  roomRef = ref(db, "rooms/" + roomCode);

  // The whole game lives under this one object in the database.
  await set(roomRef, {
    state: "lobby",        // lobby | round | locked | revealed | finished
    roundIndex: -1,        // -1 means "not started yet"
    roundOrder: [],        // chosen at Start (see startGame)
    prices: startingPrices(),
    priceHistory: startingHistory(),
    createdAt: serverTimestamp(),
    teams: {},             // filled in by players when they join
  });

  $("room-code").textContent = roomCode;

  // Listen for live changes to this room (teams joining, locking in, etc.).
  listenToRoom();
}

// ----------------------------------------------------------------------------
//  2. LISTEN to the room and re-render whenever anything changes
// ----------------------------------------------------------------------------
function listenToRoom() {
  onValue(roomRef, (snapshot) => {
    const room = snapshot.val();
    if (!room) return;

    teams = room.teams || {};
    prices = room.prices || startingPrices();
    priceHistory = room.priceHistory || startingHistory();
    roundIndex = room.roundIndex ?? -1;
    roundOrder = room.roundOrder || [];

    // Re-render whichever phase we're in.
    if (room.state === "lobby") renderLobby();
    else if (room.state === "round" || room.state === "locked") renderRound(room.state);
    else if (room.state === "revealed") renderReveal();
    else if (room.state === "finished") renderFinished();
  });
}

// Convenience: list of teams as [id, teamObject] pairs.
function teamEntries() {
  return Object.entries(teams);
}

// ----------------------------------------------------------------------------
//  LOBBY rendering
// ----------------------------------------------------------------------------
function renderLobby() {
  showPhase("lobby");
  const entries = teamEntries();

  $("lobby-count").textContent = entries.length;
  $("lobby-teams").innerHTML = entries
    .map(([, t]) => `<li class="team-chip">${escapeHtml(t.name)}</li>`)
    .join("");

  // Need at least one team to start.
  const canStart = entries.length >= 1;
  $("btn-start").disabled = !canStart;
  $("start-hint").textContent = canStart
    ? "Press Start when everyone's in."
    : "Waiting for at least one team to join…";
}

// ----------------------------------------------------------------------------
//  3. START GAME -> pick which scenarios to play, then begin round 0
// ----------------------------------------------------------------------------
$("btn-start").addEventListener("click", startGame);

async function startGame() {
  // Decide how many rounds this game plays. You can add as many scenarios as
  // you like to game-data.js; we shuffle them and take CONFIG.roundsPerGame.
  // If there are fewer scenarios than that, we just use all of them.
  const howMany = Math.min(CONFIG.roundsPerGame || ROUNDS.length, ROUNDS.length);

  // [0,1,2,3,...] -> shuffled -> first `howMany`. This is the game's round list.
  const order = shuffle([...ROUNDS.keys()]).slice(0, howMany);

  await update(roomRef, { roundOrder: order });
  roundOrder = order; // keep our local copy in sync before the first round
  startRound(0);
}

async function startRound(index) {
  // Clear every team's "locked" flag and pending choice for the new round.
  const updates = {};
  for (const [id] of teamEntries()) {
    updates[`teams/${id}/locked`] = false;
    updates[`teams/${id}/pendingAlloc`] = null;
  }
  updates["roundIndex"] = index;
  updates["state"] = "round";
  updates["roundEndsAt"] = Date.now() + CONFIG.roundTimerSeconds * 1000;
  await update(roomRef, updates);
}

// ----------------------------------------------------------------------------
//  ROUND rendering (scenario + timer + who has decided)
// ----------------------------------------------------------------------------
function renderRound(state) {
  showPhase("round");
  const round = roundData();

  $("round-quarter").textContent = round.quarter;
  $("round-counter").textContent = `Round ${roundIndex + 1} of ${roundOrder.length}`;
  $("round-title").textContent = round.title;
  $("round-headline").textContent = round.headline;
  $("round-detail").textContent = round.detail;

  // Who has locked in? (We show the name + a check, never their choice.)
  const entries = teamEntries();
  const decided = entries.filter(([, t]) => t.locked).length;
  $("decided-count").textContent = decided;
  $("team-total").textContent = entries.length;
  $("round-teams").innerHTML = entries
    .map(([, t]) =>
      `<li class="team-chip ${t.locked ? "locked" : ""}">
         ${escapeHtml(t.name)} ${t.locked ? "✅" : "…"}
       </li>`)
    .join("");

  // Buttons: once locked, you can't lock again; reveal is enabled after lock.
  const isLocked = state === "locked";
  $("btn-lock").disabled = isLocked;
  $("btn-reveal").disabled = !isLocked;

  // Start (or keep) the countdown — but only while we're still taking
  // decisions. Once locked, freeze the clock.
  if (isLocked) stopTimer();
  else startTimer();
}

// The countdown. We sync to roundEndsAt so a host refresh keeps the clock.
function startTimer() {
  if (timerInterval) return; // already running
  timerInterval = setInterval(async () => {
    const snap = await get(ref(db, `rooms/${roomCode}/roundEndsAt`));
    const endsAt = snap.val();
    const stateSnap = await get(ref(db, `rooms/${roomCode}/state`));
    if (stateSnap.val() !== "round") { stopTimer(); return; }

    const secsLeft = Math.max(0, Math.round((endsAt - Date.now()) / 1000));
    $("timer").textContent = secsLeft;
    $("timer").classList.toggle("urgent", secsLeft <= 10);

    if (secsLeft <= 0) {
      stopTimer();
      lockDecisions(); // auto-lock when time runs out
    }
  }, 250);
}

function stopTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
}

// ----------------------------------------------------------------------------
//  4a. LOCK — stop taking decisions for this round
// ----------------------------------------------------------------------------
$("btn-lock").addEventListener("click", lockDecisions);

async function lockDecisions() {
  stopTimer();
  await update(roomRef, { state: "locked" });
}

// ----------------------------------------------------------------------------
//  4b. REVEAL — the core math. Apply this round's moves to every team.
// ----------------------------------------------------------------------------
$("btn-reveal").addEventListener("click", revealResults);

async function revealResults() {
  const round = roundData();

  // STEP 1: For each team, first apply their locked-in allocation (if any),
  //         buying/selling shares at the CURRENT (pre-move) prices.
  const teamUpdates = {};
  for (const [id, t] of teamEntries()) {
    let cash = t.cash;
    let shares = { ...(t.shares || {}) };

    // If they locked a new allocation this round, rebuild their holdings from it.
    // pendingAlloc is a dollar amount they want in each stock; the rest is cash.
    if (t.pendingAlloc) {
      let spent = 0;
      shares = {};
      for (const s of STOCKS) {
        const dollars = Number(t.pendingAlloc[s.id] || 0);
        shares[s.id] = dollars / prices[s.id]; // fractional shares are fine
        spent += dollars;
      }
      // Whatever they didn't invest stays as cash.
      const totalValue = currentValue(t);
      cash = Math.max(0, totalValue - spent);
    }
    // If they did NOT lock, we keep their existing shares/cash ("Hold").

    teamUpdates[id] = { cash, shares };
  }

  // STEP 2: Move the prices by this round's percentages, and record the new
  // price in each stock's history (so the reveal screen can draw a sparkline).
  const newPrices = {};
  const updates = { state: "revealed" };
  for (const s of STOCKS) {
    const move = round.moves[s.id] ?? 0;
    newPrices[s.id] = prices[s.id] * (1 + move / 100);

    const hist = (priceHistory[s.id] || [prices[s.id]]).slice();
    hist.push(newPrices[s.id]);
    updates[`priceHistory/${s.id}`] = hist;
  }
  updates.prices = newPrices;

  // STEP 3: Recompute each team's portfolio value at the NEW prices.
  for (const [id, holding] of Object.entries(teamUpdates)) {
    let value = holding.cash;
    for (const s of STOCKS) value += (holding.shares[s.id] || 0) * newPrices[s.id];
    updates[`teams/${id}/cash`] = holding.cash;
    updates[`teams/${id}/shares`] = holding.shares;
    updates[`teams/${id}/value`] = value;
  }

  await update(roomRef, updates);
  prices = newPrices; // keep our local copy in sync
}

// Current portfolio value of a team at the CURRENT prices.
function currentValue(t) {
  let value = t.cash ?? STARTING_CASH;
  const shares = t.shares || {};
  for (const s of STOCKS) value += (shares[s.id] || 0) * prices[s.id];
  return value;
}

// ----------------------------------------------------------------------------
//  REVEAL rendering (what stocks did + leaderboard + debrief)
// ----------------------------------------------------------------------------
function renderReveal() {
  showPhase("reveal");
  stopTimer();
  const round = roundData();

  $("reveal-title").textContent = round.title;
  $("reveal-debrief").textContent = round.debrief || "";

  // Grid of stock "quote" tiles: ticker + % move, a price sparkline, and price.
  $("moves-grid").innerHTML = STOCKS.map((s) => {
    const move = round.moves[s.id] ?? 0;
    const cls = move > 0 ? "up" : move < 0 ? "down" : "flat";
    return `
      <div class="move-card ${cls}">
        <div class="move-head">
          <span class="move-ticker">${s.ticker}</span>
          <span class="move-pct">${pct(move)}</span>
        </div>
        <div class="move-name">${escapeHtml(s.name)}</div>
        ${sparkline(priceHistory[s.id], cls)}
        <div class="move-price">${money(prices[s.id])}</div>
      </div>`;
  }).join("");

  renderLeaderboard("leaderboard");

  // Last round? Switch the button to "See Final Results".
  const isLastRound = roundIndex >= roundOrder.length - 1;
  $("btn-next").textContent = isLastRound ? "See Final Results 🏆" : "Next Round";
}

// ----------------------------------------------------------------------------
//  5. NEXT ROUND (or finish)
// ----------------------------------------------------------------------------
$("btn-next").addEventListener("click", async () => {
  if (roundIndex >= roundOrder.length - 1) {
    await update(roomRef, { state: "finished" });
  } else {
    startRound(roundIndex + 1);
  }
});

// ----------------------------------------------------------------------------
//  FINISHED rendering
// ----------------------------------------------------------------------------
function renderFinished() {
  showPhase("finished");
  stopTimer();
  renderLeaderboard("final-leaderboard");
}

// ----------------------------------------------------------------------------
//  Shared leaderboard renderer (sorts teams high -> low by value)
// ----------------------------------------------------------------------------
function renderLeaderboard(targetId) {
  const ranked = teamEntries()
    .map(([, t]) => t)
    .sort((a, b) => (b.value ?? STARTING_CASH) - (a.value ?? STARTING_CASH));

  $(targetId).innerHTML = ranked
    .map((t, i) => {
      const value = t.value ?? STARTING_CASH;
      const profit = value - STARTING_CASH;
      const medal = ["🥇", "🥈", "🥉"][i] || `#${i + 1}`;
      const profitCls = profit >= 0 ? "up" : "down";
      return `
        <li class="lb-row">
          <span class="lb-rank">${medal}</span>
          <span class="lb-name">${escapeHtml(t.name)}</span>
          <span class="lb-value">${money(value)}</span>
          <span class="lb-profit ${profitCls}">${profit >= 0 ? "+" : ""}${money(profit)}</span>
        </li>`;
    })
    .join("");
}

// Build a tiny inline SVG line chart of a stock's price history.
//   values: array of prices, e.g. [100, 118, 104, ...]
//   cls:    "up" | "down" | "flat" (controls the line color)
// Returns an <svg> string; the polyline is normalized to fit the box.
function sparkline(values, cls) {
  const w = 150, h = 38, pad = 4;
  if (!values || values.length < 2) {
    return `<svg class="spark" viewBox="0 0 ${w} ${h}"></svg>`; // not enough data yet
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = (max - min) || 1;          // avoid divide-by-zero if flat
  const step = (w - 2 * pad) / (values.length - 1);

  const points = values.map((v, i) => {
    const x = pad + i * step;
    const y = h - pad - ((v - min) / range) * (h - 2 * pad); // higher price = higher up
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const [lastX, lastY] = points[points.length - 1].split(",");

  return `
    <svg class="spark spark-${cls}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <polyline points="${points.join(" ")}" />
      <circle cx="${lastX}" cy="${lastY}" r="2.4" class="spark-dot" />
    </svg>`;
}

// Prevent a mischievous team name from injecting HTML.
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ----------------------------------------------------------------------------
//  GO! Create the room as soon as the page loads.
// ----------------------------------------------------------------------------
createRoom().catch((err) => {
  alert("Could not connect to Firebase. Check firebase-config.js and that\n" +
        "Realtime Database is enabled. Details in the console.");
  console.error(err);
});
