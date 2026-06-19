// ============================================================================
//  PLAYER LOGIC — a team's phone controller
// ----------------------------------------------------------------------------
//  This screen does very little math. It:
//   1. Joins a room (creates this team under rooms/CODE/teams).
//   2. Listens to the room + its own team and shows the right screen.
//   3. The ONLY thing it writes is this team's allocation + "locked" flag.
//
//  All the real accounting (applying stock moves, computing values, ranking)
//  happens on the HOST. The phone just reflects what the host wrote.
// ============================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getDatabase, ref, get, set, update, onValue, push, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

import { firebaseConfig } from "./firebase-config.js";
import { STOCKS, ROUNDS, STARTING_CASH, CONFIG } from "./game-data.js";

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// --- helpers (same as host.js) ---
const $ = (id) => document.getElementById(id);
const money = (n) =>
  "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n) => (n >= 0 ? "+" : "") + n + "%";

function showPhase(name) {
  for (const el of document.querySelectorAll(".phase")) el.classList.add("hidden");
  $("phase-" + name).classList.remove("hidden");
}

// ----------------------------------------------------------------------------
//  Who am I? We remember our room + team id so a phone refresh stays joined.
// ----------------------------------------------------------------------------
let roomCode = sessionStorage.getItem("smg_room") || null;
let teamId = sessionStorage.getItem("smg_team") || null;
let prices = {};      // current prices from the host
let myTeam = null;    // my team object from the DB
let lastState = null; // the room's current phase

// ----------------------------------------------------------------------------
//  1. JOIN
// ----------------------------------------------------------------------------
$("join-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = $("input-code").value.trim().toUpperCase();
  const name = $("input-name").value.trim();
  const errEl = $("join-error");
  errEl.classList.add("hidden");

  if (code.length !== 4 || !name) {
    showError(errEl, "Enter a 4-letter room code and a team name.");
    return;
  }

  // Check the room exists before joining.
  const roomSnap = await get(ref(db, "rooms/" + code));
  if (!roomSnap.exists()) {
    showError(errEl, "No game with that code. Double-check the screen.");
    return;
  }

  // Create this team under the room. push() makes a unique id for us.
  const teamsRef = ref(db, `rooms/${code}/teams`);
  const newTeamRef = push(teamsRef);
  await set(newTeamRef, {
    name,
    cash: STARTING_CASH,           // every team starts with the same money
    shares: {},                    // no stock held yet
    value: STARTING_CASH,          // portfolio value = just cash at the start
    locked: false,
    joinedAt: serverTimestamp(),
  });

  // Remember who we are (survives a phone refresh during the game).
  roomCode = code;
  teamId = newTeamRef.key;
  sessionStorage.setItem("smg_room", roomCode);
  sessionStorage.setItem("smg_team", teamId);

  startListening();
});

function showError(el, msg) {
  el.textContent = msg;
  el.classList.remove("hidden");
}

// ----------------------------------------------------------------------------
//  2. LISTEN to the room and react to whatever phase the host is in
// ----------------------------------------------------------------------------
function startListening() {
  const roomRef = ref(db, "rooms/" + roomCode);
  onValue(roomRef, (snap) => {
    const room = snap.val();

    // Room was deleted (host refreshed / new game). Reset to the join screen.
    if (!room) {
      sessionStorage.clear();
      location.reload();
      return;
    }

    prices = room.prices || {};
    lastState = room.state;
    myTeam = room.teams ? room.teams[teamId] : null;

    // If our team vanished, go back to join.
    if (!myTeam) { showPhase("join"); return; }

    if (room.state === "lobby") renderLobby();
    else if (room.state === "round") renderDecide(room);
    else if (room.state === "locked") renderWait();
    else if (room.state === "revealed") renderResult(room);
    else if (room.state === "finished") renderFinished(room);
  });
}

// ----------------------------------------------------------------------------
//  LOBBY
// ----------------------------------------------------------------------------
function renderLobby() {
  showPhase("lobby");
  $("lobby-team-name").textContent = myTeam.name;
  $("lobby-cash").textContent = money(myTeam.cash);
}

// ----------------------------------------------------------------------------
//  DECIDE — allocate money across stocks, then Lock In
// ----------------------------------------------------------------------------
function renderDecide(room) {
  // If we already locked in this round, jump straight to the waiting screen.
  if (myTeam.locked) { renderWait(); return; }

  showPhase("decide");
  // roundOrder maps the game's round number to a scenario in game-data.js
  // (the host shuffles + picks them at Start). Look it up the same way.
  const round = ROUNDS[room.roundOrder[room.roundIndex]];
  const total = myValue();

  $("decide-quarter").textContent = round.quarter;
  $("decide-value").textContent = money(total);
  $("decide-title").textContent = round.title;
  $("decide-headline").textContent = round.headline;

  // Build one input row per stock. Default each box to the dollar value we
  // currently hold in that stock, so doing nothing = "Hold".
  $("alloc-list").innerHTML = STOCKS.map((s) => {
    const held = (myTeam.shares?.[s.id] || 0) * prices[s.id];
    const sector = CONFIG.showSectorsToPlayers ? `<span class="alloc-sector">${s.sector}</span>` : "";
    return `
      <div class="alloc-row">
        <div class="alloc-info">
          <div class="alloc-ticker">${s.ticker} — ${escapeHtml(s.name)}</div>
          ${sector}
          <div class="alloc-price">Price: ${money(prices[s.id])}</div>
        </div>
        <div class="alloc-input">
          <span>$</span>
          <input type="number" min="0" step="100" data-stock="${s.id}"
                 value="${Math.round(held)}" inputmode="numeric" />
        </div>
      </div>`;
  }).join("");

  // Recompute the "invested / cash left" summary whenever a box changes.
  for (const input of $("alloc-list").querySelectorAll("input")) {
    input.addEventListener("input", recalcSummary);
  }
  recalcSummary();
}

// Add up the inputs and show invested vs. leftover cash.
function recalcSummary() {
  const total = myValue();
  let invested = 0;
  for (const input of $("alloc-list").querySelectorAll("input")) {
    invested += Number(input.value || 0);
  }
  const cashLeft = total - invested;
  $("alloc-invested").textContent = money(invested);
  $("alloc-cash").textContent = money(cashLeft);

  // Warn (and block Lock In) if they tried to invest more than they have.
  const over = cashLeft < -0.005;
  $("alloc-cash").classList.toggle("over", over);
  const warn = $("alloc-warning");
  $("btn-lockin").disabled = over;
  if (over) showError(warn, `That's ${money(-cashLeft)} more than you have.`);
  else warn.classList.add("hidden");
}

// My current portfolio value at the current prices.
function myValue() {
  let v = myTeam.cash ?? STARTING_CASH;
  const shares = myTeam.shares || {};
  for (const s of STOCKS) v += (shares[s.id] || 0) * (prices[s.id] || 0);
  return v;
}

// ----------------------------------------------------------------------------
//  3. LOCK IN — write our allocation. (This is the ONLY thing players write.)
// ----------------------------------------------------------------------------
$("btn-lockin").addEventListener("click", async () => {
  const alloc = {};
  for (const input of $("alloc-list").querySelectorAll("input")) {
    alloc[input.dataset.stock] = Number(input.value || 0);
  }
  await update(ref(db, `rooms/${roomCode}/teams/${teamId}`), {
    pendingAlloc: alloc,
    locked: true,
  });
  renderWait();
});

// ----------------------------------------------------------------------------
//  WAIT
// ----------------------------------------------------------------------------
function renderWait() {
  showPhase("wait");
}

// ----------------------------------------------------------------------------
//  RESULT — after the host reveals (host already computed our new value)
// ----------------------------------------------------------------------------
function renderResult(room) {
  showPhase("result");
  const { rank, total } = myRank(room.teams);
  $("result-value").textContent = money(myTeam.value);
  $("result-rank").textContent = rank;
  $("result-total").textContent = total;

  const profit = myTeam.value - STARTING_CASH;
  $("result-change").textContent =
    (profit >= 0 ? "Up " : "Down ") + money(Math.abs(profit)) + " overall";
  $("result-change").className = "result-change " + (profit >= 0 ? "up" : "down");

  // Live leaderboard so teams can see where they stand after each round.
  renderPlayerLeaderboard(room.teams, "result-leaderboard");
}

// ----------------------------------------------------------------------------
//  FINISHED
// ----------------------------------------------------------------------------
function renderFinished(room) {
  showPhase("finished");
  const { rank, total } = myRank(room.teams);
  $("final-rank").textContent = rank;
  $("final-total").textContent = total;
  $("final-value").textContent = money(myTeam.value);
  $("final-message").textContent =
    rank === 1 ? "First place — diversification paid off." :
    rank <= 3  ? "Top three. Balanced, disciplined decisions." :
                 "Solid run. Review the full breakdown on the main screen.";

  renderPlayerLeaderboard(room.teams, "final-leaderboard");
}

// Build a compact ranked leaderboard for the phone, highlighting MY team.
function renderPlayerLeaderboard(teams, targetId) {
  const ranked = Object.entries(teams)
    .map(([id, t]) => ({ id, name: t.name, value: t.value ?? STARTING_CASH }))
    .sort((a, b) => b.value - a.value);

  $(targetId).innerHTML = ranked
    .map((t, i) => {
      const rankNum = String(i + 1).padStart(2, "0");
      const mine = t.id === teamId ? "me" : "";
      return `
        <li class="plb-row ${mine}">
          <span class="plb-rank">${rankNum}</span>
          <span class="plb-name">${escapeHtml(t.name)}${mine ? " · YOU" : ""}</span>
          <span class="plb-value">${money(t.value)}</span>
        </li>`;
    })
    .join("");
}

// Work out our rank by sorting all teams high -> low by value.
function myRank(teams) {
  const arr = Object.entries(teams)
    .map(([id, t]) => ({ id, value: t.value ?? STARTING_CASH }))
    .sort((a, b) => b.value - a.value);
  const rank = arr.findIndex((t) => t.id === teamId) + 1;
  return { rank, total: arr.length };
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ----------------------------------------------------------------------------
//  If we already joined earlier (e.g. phone refresh), reconnect automatically.
// ----------------------------------------------------------------------------
if (roomCode && teamId) startListening();
else showPhase("join");
