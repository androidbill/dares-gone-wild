import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  initializeFirestore, doc, getDoc, getDocFromServer, setDoc, updateDoc, onSnapshot,
  increment, arrayUnion, deleteField, deleteDoc, serverTimestamp,
  disableNetwork, enableNetwork,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';
import { DECKS, CLEAN_DECKS, SPICY_DECKS, PUNISHMENTS } from './dares.js';
import { WORD_CODES } from './wordcodes.js';
import { APP_VERSION } from './version.js';

const app = initializeApp(firebaseConfig);
// Auto-detect when the streaming transport is broken (iOS Safari + content blockers /
// some wifi) and fall back to long-polling — cures silent hangs.
const db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });

// Firestore promises can hang forever on a bad mobile connection — never let a UI
// flow await one without a deadline.
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
  ]);
}

// ---------------------------------------------------------------- identity
function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
let playerId = localStorage.getItem('dares_pid');
if (!playerId) { playerId = uid(); localStorage.setItem('dares_pid', playerId); }

const AVATARS = [
  '😈', '🔥', '💀', '🤠', '🥸', '😎', '🤡', '👹', '👽', '🤖',
  '🐱', '🐶', '🦊', '🐸', '🦄', '🐼', '🐙', '🦁', '🐯', '🐨',
  '🐷', '🦉', '🐢', '🦖', '🐻', '🐰', '🐵', '🐮', '🦝', '🦔',
  '🍕', '🌮', '🍩', '🍔', '🍦', '🌶️', '🎸', '🚀', '⚡', '👑',
  '🎭', '🃏', '🎲', '🏆', '💎', '🌈', '🦩', '🦜', '🐝', '🦋',
];
let myAvatar = localStorage.getItem('dares_avatar') || AVATARS[Math.floor(Math.random() * AVATARS.length)];

// ---------------------------------------------------------------- dom helpers
const $ = (id) => document.getElementById(id);
const show = (el) => el.classList.remove('hidden');
const hide = (el) => el.classList.add('hidden');
// Escapes for BOTH text and attribute contexts — names and avatars arrive from other
// people's devices, and a quote that survives breaks straight out of an attribute.
const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const SCREENS = [
  'screen-home', 'screen-lobby', 'screen-deal', 'screen-decide',
  'screen-perform', 'screen-vote', 'screen-summary', 'screen-gameover',
];
function showScreen(id) {
  for (const s of SCREENS) (s === id ? show : hide)($(s));
  if (id === 'screen-home') updateInstallBanner();
  else hide($('install-banner'));
}

let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  show(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => hide(t), 3000);
}

function buzz(pattern) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch { /* fine */ }
}

// ---------------------------------------------------------------- sound
let audioCtx = null;
function soundOn() { return localStorage.getItem('dares_sound') === 'on'; }
function unlockAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch { /* no audio on this device */ }
}
function beep(freq, dur = 0.12, vol = 0.25, type = 'square') {
  if (!soundOn()) return;
  try {
    unlockAudio();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + dur);
  } catch { /* fine */ }
}
const sndTick = () => beep(880, 0.08, 0.15);
const sndHeart = () => { beep(90, 0.09, 0.4, 'sine'); setTimeout(() => beep(75, 0.09, 0.35, 'sine'), 130); };
const sndStart = () => { beep(523, 0.1); setTimeout(() => beep(784, 0.2), 110); };
const sndBuzzer = () => beep(180, 0.7, 0.35, 'sawtooth');
const sndGood = () => { beep(660, 0.1); setTimeout(() => beep(990, 0.15), 90); };
const sndBad = () => beep(220, 0.2, 0.2, 'sawtooth');
const sndChicken = () => { beep(400, 0.08, 0.2); setTimeout(() => beep(300, 0.08, 0.2), 90); setTimeout(() => beep(200, 0.2, 0.2), 180); };
const sndFanfare = () => {
  [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.2, 0.25), i * 120));
};

// ---------------------------------------------------------------- themes
const THEMES = {
  devil:   { name: '😈 Devil\'s Night', vars: { '--bg1': '#1b0a1e', '--bg2': '#3a0f36', '--bg3': '#5c1442', '--accent': '#ff9e6b', '--accent2': '#ff5f6d', '--blue': '#ffd166' } },
  inferno: { name: '🔥 Inferno',        vars: { '--bg1': '#240604', '--bg2': '#4d1008', '--bg3': '#7a1c0c', '--accent': '#ffb454', '--accent2': '#ff5a1f', '--blue': '#ffd166' } },
  midnight:{ name: '🌌 Midnight',       vars: { '--bg1': '#1a1033', '--bg2': '#2d1457', '--bg3': '#431a6e', '--accent': '#ffd166', '--accent2': '#ffb733', '--blue': '#4cc9f0' } },
  toxic:   { name: '☢️ Toxic',          vars: { '--bg1': '#0b1c07', '--bg2': '#153a0d', '--bg3': '#1f5714', '--accent': '#b9f24d', '--accent2': '#7ddf1f', '--blue': '#e8ff8a' } },
  ocean:   { name: '🌊 Deep Water',     vars: { '--bg1': '#041e30', '--bg2': '#07395c', '--bg3': '#0a5580', '--accent': '#66d9ff', '--accent2': '#38bdf8', '--blue': '#8be9fd' } },
  grape:   { name: '🍇 Neon Grape',     vars: { '--bg1': '#1c0630', '--bg2': '#38105c', '--bg3': '#551a85', '--accent': '#d8b4fe', '--accent2': '#c084fc', '--blue': '#e879f9' } },
  candy:   { name: '🍭 Sugar Rush',     vars: { '--bg1': '#2b0620', '--bg2': '#59103f', '--bg3': '#86195e', '--accent': '#ffb3d9', '--accent2': '#ff5fa2', '--blue': '#ffe066' } },
  blackout:{ name: '🖤 Blackout',       vars: { '--bg1': '#0a0a0f', '--bg2': '#16161f', '--bg3': '#22222e', '--accent': '#ff9e6b', '--accent2': '#ff5f6d', '--blue': '#9ca3af' } },
};

function applyTheme(key) {
  const t = THEMES[key] || THEMES.devil;
  for (const [k, v] of Object.entries(t.vars)) document.documentElement.style.setProperty(k, v);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t.vars['--bg1']);
  localStorage.setItem('dares_theme', key in THEMES ? key : 'devil');
}

function openThemes() {
  const current = localStorage.getItem('dares_theme') || 'devil';
  $('theme-grid').innerHTML = Object.entries(THEMES).map(([key, t]) =>
    `<button class="theme-swatch${key === current ? ' selected' : ''}" data-theme="${esc(key)}">
      <span class="sw-colors" style="background:linear-gradient(120deg, ${t.vars['--bg2']} 0%, ${t.vars['--bg3']} 55%, ${t.vars['--accent']} 130%)"></span>
      <span class="sw-name">${esc(t.name)}</span>
    </button>`
  ).join('');
  for (const b of document.querySelectorAll('.theme-swatch')) {
    b.addEventListener('click', () => { applyTheme(b.dataset.theme); openThemes(); });
  }
  show($('theme-modal'));
}
applyTheme(localStorage.getItem('dares_theme') || 'devil');

// ---------------------------------------------------------------- confetti
function confettiBurst(count = 110, durationMs = 2600) {
  const colors = ['#ff9e6b', '#ff5f6d', '#ffd166', '#4cc9f0', '#34d399', '#d8b4fe'];
  for (let i = 0; i < count; i++) {
    const bit = document.createElement('div');
    bit.className = 'confetti-bit';
    bit.style.left = `${Math.random() * 100}vw`;
    bit.style.background = colors[Math.floor(Math.random() * colors.length)];
    const fall = 1400 + Math.random() * 1200;
    bit.animate([
      { transform: `translateY(0) rotate(0deg)`, opacity: 1 },
      { transform: `translateY(102vh) rotate(${540 + Math.random() * 540}deg)`, opacity: 0.85 },
    ], { duration: fall, delay: Math.random() * 400, easing: 'cubic-bezier(.25,.6,.5,1)' });
    document.body.appendChild(bit);
  }
  setTimeout(() => {
    for (const b of document.querySelectorAll('.confetti-bit')) b.remove();
  }, durationMs);
}

// ---------------------------------------------------------------- wake lock
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator) {
      if (!wakeLock) wakeLock = await navigator.wakeLock.request('screen');
    } else if (wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { wakeLock = null; }
}

// A phone that was asleep, backgrounded or offline comes back with a dead stream —
// every one of these events is a chance to notice and repair it.
function wakeUp() {
  if (!roomRef) return;
  if (wakeLock === null && room && ['perform', 'decide'].includes(room.state)) keepAwake(true);
  resubscribe(true);
  pullFromServer(true);
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') wakeUp();
});
window.addEventListener('online', () => wakeUp());
window.addEventListener('pageshow', () => wakeUp());
window.addEventListener('focus', () => wakeUp());

// ---------------------------------------------------------------- room state
const ROOM_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours — one very long party
const COUNTDOWN_MS = 3500;
const VOTE_LIMIT_MS = 45000;            // votes are counted automatically after this
const DEFAULT_DARE_SECONDS = 45;
const ACK_SECONDS = 25;                 // "rule change" cards (sec: 0) just need acknowledging

// Heat drives everything: the label, the colour, and what the dare is worth.
const POINTS = { 1: 1, 2: 2, 3: 3, 4: 5, 5: 8 };
const HEAT_LABEL = { 1: 'Warm Up', 2: 'Easy', 3: 'Standard', 4: 'Bold', 5: 'Unhinged' };
// Which heats each "How wild?" setting will deal.
const HEAT_RANGE = { mild: [1, 2, 3], medium: [2, 3, 4], wild: [3, 4, 5] };

let roomCode = null;
let roomRef = null;
let unsub = null;
let room = null;
let timerInterval = null;
let lastTickSecond = null;
let prevKey = null;
// Local time at which the current performance began, derived from the round's SERVER
// start time via the measured clock offset — so every phone lands on the same instant
// even though their own clocks disagree.
let roundAnchor = null;
let syncedAnchor = false;
let seenReactionTs = -1;
let lastReactionSent = 0;
let overrideTimer = null;
let nudgedAt = 0;
let nudgeCount = 0;

// ---------------------------------------------------------------- small helpers
function makeCode() { return pickRandom(WORD_CODES); }
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function myName() { return ($('name-input').value || '').trim(); }
function isHost() { return room && room.hostId === playerId; }
function isDarer() { return room?.round?.darerId === playerId; }
function isTarget() { return room?.round?.targetId === playerId; }
function nameOf(id) {
  const p = room?.players?.[id];
  return p ? `${p.avatar || '🙂'} ${p.name}` : '???';
}
function plainName(id) { return room?.players?.[id]?.name || 'someone'; }
function meRec() { return room?.players?.[playerId] || {}; }
function heatStars(heat) { return '🔥'.repeat(heat); }
function darePoints(r) { return r?.points || POINTS[r?.dare?.heat || 2] || 2; }

// Seconds this card gets, honouring the room's cap. Cards with sec: 0 are standing
// rule changes rather than performances — they only need long enough to acknowledge.
function dareSeconds(dare, settings) {
  const cap = settings?.performSeconds || 60;
  const raw = dare?.sec ? dare.sec : (dare?.sec === 0 ? ACK_SECONDS : DEFAULT_DARE_SECONDS);
  return Math.max(10, Math.min(raw, dare?.sec === 0 ? ACK_SECONDS : cap));
}

// ---------------------------------------------------------------- dare pool
function activeDeckIds(settings) {
  const chosen = settings?.decks?.length ? settings.decks : CLEAN_DECKS;
  return chosen.filter((id) => DECKS[id] && (settings?.spicy || !DECKS[id].spicy));
}

// Every dare from the live decks that fits the heat setting, minus anything already
// dealt this game. Falls back to the full pool once the room has burned through it.
function buildDarePool(settings, usedTexts) {
  const heats = new Set(HEAT_RANGE[settings?.heat || 'medium'] || HEAT_RANGE.medium);
  const used = new Set(usedTexts || []);
  const all = [];
  for (const id of activeDeckIds(settings)) {
    for (const d of DECKS[id].dares) {
      if (heats.has(d.heat)) all.push({ ...d, deck: id });
    }
  }
  const fresh = all.filter((d) => !used.has(d.t));
  return fresh.length >= 2 ? fresh : all;
}

// {TARGET} / {DARER} / {P} are resolved once, at deal time, so every phone renders
// exactly the same sentence.
function fillNames(text, darerId, targetId) {
  const ids = Object.keys(room?.players || {});
  const others = ids.filter((id) => id !== darerId && id !== targetId);
  const third = others.length ? plainName(pickRandom(others)) : plainName(darerId);
  return String(text)
    .replace(/\{TARGET\}/g, plainName(targetId))
    .replace(/\{DARER\}/g, plainName(darerId))
    .replace(/\{P\}/g, third);
}

function drawChoices(darerId, targetId) {
  const pool = shuffle(buildDarePool(room.settings, room.usedDares));
  const picked = [pool[0], pool[1] || pool[0]];
  return picked.map((d) => ({
    t: fillNames(d.t, darerId, targetId),
    raw: d.t,
    heat: d.heat,
    sec: d.sec,
    deck: d.deck,
  }));
}

// ---------------------------------------------------------------- create / join
function roomIsStale(data) {
  if (!data) return true;
  const expires = typeof data.expiresAt?.toMillis === 'function'
    ? data.expiresAt.toMillis()
    : (data.createdAt || 0) + ROOM_TTL_MS;
  return Date.now() > expires;
}

function freshPlayer(name) {
  return {
    name, avatar: myAvatar, score: 0, joinedAt: Date.now(),
    vetoesLeft: 2, bouncesLeft: 1,
    accepts: 0, chickens: 0, nailed: 0, vetoed: 0, heatDealt: 0,
  };
}

async function createRoom() {
  const name = myName();
  if (!name) return toast('Enter your name first!');
  localStorage.setItem('dares_name', name);
  $('btn-create').disabled = true;
  try {
    let code = null;
    let lookupFailed = false;
    for (let i = 0; i < 12; i++) {
      const candidate = makeCode();
      try {
        const snap = await withTimeout(getDoc(doc(db, 'rooms', candidate)), 4000);
        if (!snap.exists() || roomIsStale(snap.data())) { code = candidate; break; }
      } catch {
        // Lookup hung on a flaky connection. Take the code rather than stall the party.
        code = candidate;
        lookupFailed = true;
        break;
      }
    }
    if (!code) return toast('Every room code is busy right now — try again in a minute!');
    if (lookupFailed) console.warn('room code taken without verification');

    // Fire the write and enter immediately — never wait on a server ack that a flaky
    // phone connection might swallow. The live listener confirms it.
    setDoc(doc(db, 'rooms', code), {
      code,
      createdAt: Date.now(),
      expiresAt: new Date(Date.now() + ROOM_TTL_MS),
      hostId: playerId,
      state: 'lobby',
      settings: {
        decks: ['party', 'stage', 'physical', 'cringe'],
        heat: 'medium',
        spicy: false,
        performSeconds: 60,
        targetScore: 0,
        vetoes: 2,
      },
      players: { [playerId]: freshPlayer(name) },
      upQueue: [],
      usedDares: [],
      round: null,
      roundNum: 0,
    }).catch((e) => { console.error(e); toast('Could not create room — check your connection.'); });
    enterRoom(code);
  } finally {
    $('btn-create').disabled = false;
  }
}

async function joinRoom() {
  const name = myName();
  const code = ($('code-input').value || '').trim().toUpperCase();
  if (!name) return toast('Enter your name first!');
  if (code.length !== 4) return toast('Room codes are 4 letters.');
  localStorage.setItem('dares_name', name);
  $('btn-join').disabled = true;
  try {
    const ref = doc(db, 'rooms', code);
    let data = null;
    try {
      const snap = await withTimeout(getDoc(ref), 6000);
      if (!snap.exists()) return toast(`Room ${code} not found.`);
      data = snap.data();
      if (roomIsStale(data)) return toast(`Room ${code} has expired — ask for a new code.`);
    } catch {
      // lookup hung — join optimistically; the live listener bounces us back if the
      // room really isn't there
    }
    if (data && !data.players?.[playerId]) {
      const taken = Object.values(data.players || {}).some(
        (p) => p.name.toLowerCase() === name.toLowerCase()
      );
      if (taken) return toast('That name is taken in this room — pick another.');
    }
    if (!data || !data.players?.[playerId]) {
      const p = freshPlayer(name);
      p.vetoesLeft = data?.settings?.vetoes ?? 2;
      updateDoc(ref, { [`players.${playerId}`]: p }).catch(() => {});
    }
    enterRoom(code);
  } finally {
    $('btn-join').disabled = false;
  }
}

// ---------------------------------------------------------------- clock sync
// Phone clocks disagree — sometimes by minutes. Each phone measures its own offset from
// Firestore's server clock and all timing is done in SERVER time. The measurement rides
// along on the heartbeat the room already writes, so it costs nothing extra.
let clockSamples = [];
let clockOffset = null; // serverMs - localMs

function noteServerTime(serverMs) {
  // A heartbeat reaches us some unknown latency after the server stamped it, so every
  // sample UNDER-estimates the offset. The largest recent sample travelled fastest and
  // is therefore closest to the truth.
  clockSamples.push(serverMs - Date.now());
  if (clockSamples.length > 8) clockSamples.shift();
  clockOffset = Math.max(...clockSamples);
}
function clockReady() { return clockOffset !== null; }
function serverNow() { return Date.now() + (clockOffset || 0); }
function toLocal(serverMs) { return serverMs - (clockOffset || 0); }

// ---------------------------------------------------------------- liveness
// Phones dim, lock, background the browser, or drop wifi mid-game — any of which can
// silently wedge the live Firestore stream and freeze that phone on a stale round. One
// device heartbeats every few seconds, so every healthy phone MUST receive a
// server-sent snapshot on that cadence. Going quiet is proof this phone's stream is
// broken, and it repairs itself.
//
// The heartbeat lives in its OWN tiny document, never in the room: Firestore has no
// field-level deltas, so beating inside the room would re-broadcast the whole game
// state to every phone every few seconds.
const PULSE_MS = 4000;
const HEALTH_MS = 2000;
const STALE_RESUB_MS = 11000;
const STALE_PULL_MS = 17000;
const STALE_RESET_MS = 26000;
const TAKEOVER_MS = 12000;
let pulseRef = null;
let unsubPulse = null;
let pulseMode = 'doc';    // falls back to 'room' if pulses/ isn't writable yet
let lastFreshAt = 0;
let lastResubAt = 0;
let lastPullAt = 0;
let lastPulseWrite = 0;
let lastPulseServerMs = 0;
let lastPulseSeenAt = 0;
let lastPulseBy = null;
let healthInterval = null;
let pulling = false;
let resetting = false;

function setConnBadge(bad) {
  const el = $('conn-badge');
  if (el) (bad ? show : hide)(el);
}

// Every listener rides the same Firestore connection, so a delivery on either stream
// proves the whole transport is alive.
function markFresh() { lastFreshAt = Date.now(); }

function applyRoom(data, fresh) {
  if (fresh) markFresh();
  room = data;
  if (data.pulseAt) applyPulse({ at: data.pulseAt, by: data.pulseBy }, fresh);
  render();
}

function applyPulse(data, fresh) {
  if (fresh) markFresh();
  const ms = typeof data?.at?.toMillis === 'function' ? data.at.toMillis() : 0;
  // Only a *newly arrived* heartbeat is a usable clock sample — re-reading an older one
  // would look like a hugely delayed beat and drag the measurement off.
  if (ms > lastPulseServerMs) {
    lastPulseServerMs = ms;
    lastPulseSeenAt = Date.now();
    lastPulseBy = data.by || null;
    if (fresh) { noteServerTime(ms); refreshAnchor(); }
  }
}

function pulseUnavailable() {
  if (pulseMode === 'room') return;
  pulseMode = 'room';
  if (unsubPulse) { unsubPulse(); unsubPulse = null; }
  console.warn('Dares Gone Wild: pulses/ is not accessible — falling back to in-room '
    + 'heartbeat. Deploy firestore.rules to restore the cheap path.');
}

function subscribePulse() {
  if (!pulseRef || pulseMode !== 'doc') return;
  if (unsubPulse) { unsubPulse(); unsubPulse = null; }
  unsubPulse = onSnapshot(pulseRef, { includeMetadataChanges: true }, (snap) => {
    if (snap.exists()) applyPulse(snap.data(), !snap.metadata.fromCache);
  }, (err) => {
    if (err?.code === 'permission-denied') pulseUnavailable();
  });
}

function subscribeRoom() {
  if (!roomRef) return;
  if (unsub) { unsub(); unsub = null; }
  // includeMetadataChanges lets us tell a real server delivery from a cache replay —
  // without it, re-attaching a listener always looks "healthy" even when the underlying
  // connection is dead, which is what leaves phones sitting on stale rounds.
  unsub = onSnapshot(roomRef, { includeMetadataChanges: true }, (snap) => {
    if (!snap.exists()) {
      if (snap.metadata.fromCache) return; // offline cache miss, not a closed room
      toast('The room was closed.');
      leaveRoom(false);
      return;
    }
    applyRoom(snap.data(), !snap.metadata.fromCache);
  }, (err) => {
    console.error(err);
    setTimeout(() => resubscribe(true), 1500);
  });
}

function resubscribe(force = false) {
  if (!roomRef) return;
  if (!force && Date.now() - lastResubAt < 4000) return; // don't thrash
  lastResubAt = Date.now();
  subscribeRoom();
  subscribePulse();
}

// Rung 2 of the recovery ladder: bypass the stream and read the room off the server.
async function pullFromServer(force = false) {
  if (!roomRef || pulling) return;
  if (!force && Date.now() - lastPullAt < 5000) return;
  lastPullAt = Date.now();
  pulling = true;
  try {
    const snap = await withTimeout(getDocFromServer(roomRef), 6000);
    if (snap.exists()) applyRoom(snap.data(), true);
    // A phone with no clock reading yet cannot time anything, so chase the heartbeat
    // too rather than wait for the next broadcast.
    if (!clockReady() && pulseRef && pulseMode === 'doc') {
      const ps = await withTimeout(getDocFromServer(pulseRef), 6000);
      if (ps.exists()) applyPulse(ps.data(), true);
    }
  } catch { /* still wedged — the next rung handles it */ }
  finally { pulling = false; }
}

// Rung 3: tear the whole transport down and rebuild it. This is the one that actually
// cures a jammed iOS Safari long-poll; re-attaching listeners does not.
async function hardReset() {
  if (!roomRef || resetting) return;
  resetting = true;
  try {
    if (unsub) { unsub(); unsub = null; }
    if (unsubPulse) { unsubPulse(); unsubPulse = null; }
    await withTimeout(disableNetwork(db), 4000);
    await withTimeout(enableNetwork(db), 4000);
    subscribeRoom();
    subscribePulse();
    await pullFromServer(true);
  } catch { /* try again next cycle */ }
  finally { setTimeout(() => { resetting = false; }, 8000); }
}

// Heartbeat duty, in preference order: host first, everyone else next, and whoever is
// performing dead last — their phone is busy being waved around mid-dare.
function pulseCandidates() {
  if (!room?.players) return [];
  const ids = Object.keys(room.players).sort();
  const target = room.round?.targetId;
  const host = room.hostId;
  const head = (host && host !== target && ids.includes(host)) ? [host] : [];
  const tail = (target && ids.includes(target)) ? [target] : [];
  const middle = ids.filter((id) => !head.includes(id) && !tail.includes(id));
  return [...head, ...middle, ...tail];
}

// Exactly one phone beats at a time. The preferred candidate always does; a backup steps
// in only after the beat has been missing a while, and then KEEPS it (it can see its own
// id in `by`). Without that stickiness the backups would each beat once and fall silent,
// and the room would flap between bursts and dead air.
function shouldPulse() {
  if (!room) return false;
  const list = pulseCandidates();
  const rank = list.indexOf(playerId);
  if (rank < 0) return false;
  if (rank === 0) return true;
  if (lastPulseBy === playerId) return true;
  const silence = Date.now() - lastPulseSeenAt;
  const leaderRank = list.indexOf(lastPulseBy);
  const leaderAlive = leaderRank >= 0 && leaderRank < rank && silence < TAKEOVER_MS;
  return !leaderAlive && silence >= rank * TAKEOVER_MS;
}

async function writePulse(force = false) {
  if (!roomRef) return;
  if (!force && Date.now() - lastPulseWrite < PULSE_MS - 400) return;
  lastPulseWrite = Date.now();
  if (pulseMode === 'doc' && pulseRef) {
    try {
      await setDoc(pulseRef, {
        at: serverTimestamp(), by: playerId, code: roomCode,
        expiresAt: new Date(Date.now() + ROOM_TTL_MS),
      });
      return;
    } catch (e) {
      if (e?.code !== 'permission-denied') return; // transient — beat again later
      pulseUnavailable();
    }
  }
  try {
    await updateDoc(roomRef, { pulseAt: serverTimestamp(), pulseBy: playerId });
  } catch { /* fine */ }
}

function healthCheck() {
  if (!roomRef) return;

  if (shouldPulse()) writePulse();

  const stale = Date.now() - lastFreshAt;
  if (stale > STALE_RESET_MS) hardReset();
  else if (stale > STALE_PULL_MS) pullFromServer();
  else if (stale > STALE_RESUB_MS) resubscribe(true);
  setConnBadge(stale > STALE_RESUB_MS);

  // Nobody has voted you out yet, but the vote can't hang forever on one AFK phone.
  if (room?.state === 'vote' && isResolver() && clockReady()) {
    const started = room.round?.voteStartsAt || 0;
    if (started && serverNow() - started > VOTE_LIMIT_MS) resolveVotes();
  }

  // It's your turn and your phone has been sitting there — keep nudging until you act,
  // but give up after ~40s so a phone left on the table doesn't buzz all night.
  const waitingOnMe = (room?.state === 'deal' && isDarer())
    || (room?.state === 'decide' && isTarget());
  if (waitingOnMe && nudgeCount < 8 && Date.now() - nudgedAt > 5000) {
    nudgedAt = Date.now();
    nudgeCount += 1;
    buzz([70, 60, 70]);
  }
}

function enterRoom(code) {
  roomCode = code;
  roomRef = doc(db, 'rooms', code);
  pulseRef = doc(db, 'pulses', code);
  localStorage.setItem('dares_room', code);
  seenReactionTs = -1;
  const now = Date.now();
  lastFreshAt = now;
  lastPulseSeenAt = now;
  lastPulseWrite = 0;
  lastPulseServerMs = 0;
  lastPulseBy = null;
  clockSamples = [];
  clockOffset = null;
  subscribeRoom();
  subscribePulse();
  // One immediate heartbeat so this phone gets a clock reading right away instead of
  // waiting on someone else's — nothing can be timed accurately until it has one.
  writePulse(true);
  if (healthInterval) clearInterval(healthInterval);
  healthInterval = setInterval(healthCheck, HEALTH_MS);
}

async function leaveRoom(removeSelf = true) {
  if (unsub) { unsub(); unsub = null; }
  if (removeSelf && roomRef && room) {
    try {
      if (isHost() && Object.keys(room.players || {}).length === 1) {
        // last one out closes the room — and its heartbeat, so codes are freed
        await deleteDoc(roomRef);
        if (pulseRef) deleteDoc(pulseRef).catch(() => {});
      } else {
        const updates = { [`players.${playerId}`]: deleteField() };
        const remaining = Object.keys(room.players).filter((id) => id !== playerId);
        if (isHost() && remaining.length) updates.hostId = remaining[0];
        updates.upQueue = (room.upQueue || []).filter((id) => id !== playerId);

        // Walking out mid-round must never strand the room.
        if (room.state !== 'lobby' && remaining.length < 2) {
          updates.state = 'gameover';
          updates.round = null;
        } else if (room.round && ['deal', 'decide', 'perform', 'vote'].includes(room.state)) {
          const r = room.round;
          if (r.targetId === playerId) {
            // the person being dared left — abandon the dare, nobody scores
            updates.state = 'summary';
            updates['round.outcome'] = 'left';
            updates['round.awarded'] = 0;
          } else if (r.darerId === playerId) {
            const pool = remaining.filter((id) => id !== r.targetId);
            if (room.state === 'deal') {
              // nobody left to pick the card — hand the job to someone else
              updates['round.darerId'] = pickRandom(pool.length ? pool : remaining);
            } else {
              updates['round.darerId'] = pickRandom(pool.length ? pool : remaining);
            }
          }
          if (room.state === 'vote') updates[`round.votes.${playerId}`] = deleteField();
        }
        await updateDoc(roomRef, updates);
      }
    } catch { /* best effort */ }
  }
  if (unsubPulse) { unsubPulse(); unsubPulse = null; }
  if (healthInterval) { clearInterval(healthInterval); healthInterval = null; }
  setConnBadge(false);
  roomCode = null; roomRef = null; pulseRef = null; room = null;
  roundAnchor = null; syncedAnchor = false;
  prevKey = null; lastRenderSig = null;
  clockSamples = []; clockOffset = null;
  lastPulseServerMs = 0; lastPulseBy = null;
  localStorage.removeItem('dares_room');
  stopTimer();
  keepAwake(false);
  showScreen('screen-home');
}

// ---------------------------------------------------------------- round flow
// Whoever dealt the dare tallies the votes — they're the one player guaranteed not to
// be performing. The host is the fallback if the darer's phone has gone quiet.
function isResolver() {
  if (!room?.round) return false;
  const ids = Object.keys(room.players || {});
  if (ids.includes(room.round.darerId)) return isDarer();
  return isHost();
}

function nextAssignments() {
  const ids = Object.keys(room.players || {});
  let queue = (room.upQueue || []).filter((id) => ids.includes(id));
  if (!queue.length) {
    // Everyone has had a turn — reshuffle for the next lap. Without the rotate, a
    // fresh shuffle can hand the player who just dealt a second turn straight away,
    // which is very noticeable in a three- or four-person room.
    queue = shuffle(ids);
    if (ids.length > 1 && queue[0] === room.round?.darerId) queue.push(queue.shift());
  }
  const darerId = queue[0];
  queue = queue.slice(1);
  const pool = ids.filter((id) => id !== darerId);
  return { darerId, targetId: pickRandom(pool), queue };
}

function newRound(darerId, targetId) {
  return {
    darerId,
    targetId,
    choices: drawChoices(darerId, targetId),
    dare: null,
    points: 0,
    bounced: false,
    startsAt: null,
    synced: false,
    voteStartsAt: null,
    votes: {},
    outcome: null,
    awarded: 0,
    punishment: null,
  };
}

async function startGame() {
  if (!isHost()) return;
  const ids = Object.keys(room.players || {});
  if (ids.length < 2) return toast('You need at least 2 players!');
  if (!activeDeckIds(room.settings).length) return toast('Pick at least one deck first!');

  const vetoes = room.settings.vetoes ?? 2;
  const updates = { state: 'deal', roundNum: 1, usedDares: [] };
  // Everyone starts the game with a clean slate of vetoes, bounces and stats.
  for (const id of ids) {
    updates[`players.${id}.score`] = 0;
    updates[`players.${id}.vetoesLeft`] = vetoes;
    updates[`players.${id}.bouncesLeft`] = 1;
    updates[`players.${id}.accepts`] = 0;
    updates[`players.${id}.chickens`] = 0;
    updates[`players.${id}.nailed`] = 0;
    updates[`players.${id}.vetoed`] = 0;
    updates[`players.${id}.heatDealt`] = 0;
  }
  room.upQueue = [];
  const { darerId, targetId, queue } = nextAssignments();
  updates.upQueue = queue;
  updates.round = newRound(darerId, targetId);

  try { await updateDoc(roomRef, updates); }
  catch (e) { console.error(e); toast('Could not start the game.'); }
}

let tapLock = false;
function lockTaps(ms = 400) {
  if (tapLock) return false;
  tapLock = true;
  setTimeout(() => { tapLock = false; }, ms);
  return true;
}

async function chooseDare(index) {
  if (!room || room.state !== 'deal') return;
  if (!isDarer() && !isHost()) return;
  if (!lockTaps()) return;
  const dare = room.round?.choices?.[index];
  if (!dare) return;
  const { raw, ...card } = dare;
  try {
    await updateDoc(roomRef, {
      state: 'decide',
      'round.dare': card,
      'round.points': POINTS[card.heat] || 2,
      'round.choices': deleteField(),
      usedDares: arrayUnion(raw || card.t),
      [`players.${room.round.darerId}.heatDealt`]: increment(card.heat),
    });
  } catch (e) { console.error(e); toast('Something went wrong — try again.'); }
}

async function acceptDare() {
  if (!room || room.state !== 'decide' || !isTarget()) return;
  if (!lockTaps()) return;
  const secs = dareSeconds(room.round.dare, room.settings);
  // startsAt is in SERVER time so every phone converts it to its own clock and lands on
  // the same instant. `synced` records whether this phone actually had a server reading —
  // if it didn't, the number is just its own clock and nobody else should trust it.
  const startsAt = serverNow() + COUNTDOWN_MS;
  try {
    await updateDoc(roomRef, {
      state: 'perform',
      'round.startsAt': startsAt,
      'round.endsAt': startsAt + secs * 1000,
      'round.seconds': secs,
      'round.synced': clockReady(),
      [`players.${playerId}.accepts`]: increment(1),
    });
  } catch (e) { console.error(e); toast('Something went wrong — try again.'); }
}

async function bounceDare() {
  if (!room || room.state !== 'decide' || !isTarget()) return;
  if (room.round.bounced) return toast('This one has already been bounced!');
  if ((meRec().bouncesLeft ?? 0) <= 0) return toast('You have already used your Dare Back!');
  if (!lockTaps()) return;
  const r = room.round;
  try {
    await updateDoc(roomRef, {
      'round.darerId': r.targetId,
      'round.targetId': r.darerId,
      'round.bounced': true,
      'round.points': (r.points || 2) * 2,
      [`players.${playerId}.bouncesLeft`]: increment(-1),
    });
    buzz([40, 40, 90]);
  } catch (e) { console.error(e); toast('Something went wrong — try again.'); }
}

async function chickenOut() {
  if (!room || room.state !== 'decide' || !isTarget()) return;
  if (!lockTaps()) return;
  const r = room.round;
  try {
    await updateDoc(roomRef, {
      state: 'summary',
      'round.outcome': 'chicken',
      'round.awarded': -1,
      'round.punishment': pickRandom(PUNISHMENTS),
      [`players.${playerId}.score`]: increment(-1),
      [`players.${playerId}.chickens`]: increment(1),
      [`players.${r.darerId}.score`]: increment(1),
    });
  } catch (e) { console.error(e); toast('Something went wrong — try again.'); }
}

async function vetoDare() {
  if (!room || room.state !== 'decide' || !isTarget()) return;
  if ((meRec().vetoesLeft ?? 0) <= 0) return toast('You are out of vetoes.');
  if (!lockTaps()) return;
  try {
    await updateDoc(roomRef, {
      state: 'summary',
      'round.outcome': 'veto',
      'round.awarded': 0,
      [`players.${playerId}.vetoesLeft`]: increment(-1),
      [`players.${playerId}.vetoed`]: increment(1),
    });
  } catch (e) { console.error(e); toast('Something went wrong — try again.'); }
}

// The performance is over — either they tapped Done or the clock ran out.
async function finishPerforming() {
  if (!room || room.state !== 'perform') return;
  try {
    await updateDoc(roomRef, {
      state: 'vote',
      'round.voteStartsAt': serverNow(),
      'round.votes': {},
    });
  } catch (e) { console.error(e); }
}

async function castVote(nailed) {
  if (!room || room.state !== 'vote' || isTarget()) return;
  if (!lockTaps(250)) return;
  try {
    await updateDoc(roomRef, { [`round.votes.${playerId}`]: !!nailed });
    buzz(30);
  } catch (e) { console.error(e); }
}

function voterIds() {
  return Object.keys(room?.players || {}).filter((id) => id !== room?.round?.targetId);
}

let resolving = false;
async function resolveVotes() {
  if (!room || room.state !== 'vote' || resolving) return;
  resolving = true;
  setTimeout(() => { resolving = false; }, 4000);
  const r = room.round;
  const votes = Object.values(r.votes || {});
  const yes = votes.filter(Boolean).length;
  const no = votes.length - yes;
  // A tie goes to the performer — they did get up and do the thing.
  const nailed = votes.length === 0 || yes >= no;
  const full = darePoints(r);
  const awarded = nailed ? full : Math.max(1, Math.floor(full / 2));
  try {
    await updateDoc(roomRef, {
      state: 'summary',
      'round.outcome': nailed ? 'nailed' : 'weak',
      'round.awarded': awarded,
      'round.tally': { yes, no },
      [`players.${r.targetId}.score`]: increment(awarded),
      ...(nailed ? { [`players.${r.targetId}.nailed`]: increment(1) } : {}),
    });
  } catch (e) { console.error(e); }
}

function targetReached() {
  const goal = room?.settings?.targetScore || 0;
  if (!goal) return false;
  return Object.values(room.players || {}).some((p) => (p.score || 0) >= goal);
}

async function nextRound() {
  if (!room || room.state !== 'summary') return;
  if (!isHost() && !isDarer()) return;
  if (!lockTaps()) return;
  if (targetReached()) return endGame();
  const { darerId, targetId, queue } = nextAssignments();
  try {
    await updateDoc(roomRef, {
      state: 'deal',
      roundNum: increment(1),
      upQueue: queue,
      round: newRound(darerId, targetId),
    });
  } catch (e) { console.error(e); toast('Could not start the next round.'); }
}

async function endGame() {
  try { await updateDoc(roomRef, { state: 'gameover', round: null }); }
  catch (e) { console.error(e); }
}

// Host escape hatch: an AFK phone should never be able to hold the whole party hostage.
async function skipDare() {
  if (!room || !isHost()) return;
  if (!['deal', 'decide', 'perform', 'vote'].includes(room.state)) return;
  try {
    await updateDoc(roomRef, {
      state: 'summary',
      'round.outcome': 'skipped',
      'round.awarded': 0,
    });
  } catch (e) { console.error(e); }
}

async function playAgain() {
  if (!isHost()) return;
  try { await updateDoc(roomRef, { state: 'lobby', round: null, roundNum: 0, upQueue: [] }); }
  catch (e) { console.error(e); }
}

// ---------------------------------------------------------------- reactions
async function sendReaction(emoji) {
  if (!room || Date.now() - lastReactionSent < 900) return;
  lastReactionSent = Date.now();
  try {
    await updateDoc(roomRef, {
      lastReaction: { emoji, name: plainName(playerId), ts: Date.now() },
    });
  } catch { /* fine */ }
}

function spawnReaction(emoji, name) {
  const el = document.createElement('div');
  el.className = 'float-reaction';
  el.style.left = `${8 + Math.random() * 74}vw`;
  el.innerHTML = `${esc(emoji)}<small>${esc(name || '')}</small>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

// ---------------------------------------------------------------- timer
function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  lastTickSecond = null;
}

function startTimerLoop() {
  stopTimer();
  timerInterval = setInterval(tick, 200);
  tick();
}

function tick() {
  if (!room || room.state !== 'perform' || !roundAnchor) { stopTimer(); return; }

  const elapsed = Date.now() - roundAnchor;
  const overlay = $('countdown-overlay');

  if (elapsed < COUNTDOWN_MS) {
    const n = Math.ceil((COUNTDOWN_MS - elapsed) / 1000);
    $('countdown-num').textContent = n > 3 ? '3' : String(n);
    show(overlay);
    return;
  }
  if (!overlay.classList.contains('hidden')) {
    hide(overlay);
    sndStart();
  }

  const total = (room.round.seconds || DEFAULT_DARE_SECONDS) * 1000;
  const msLeft = Math.max(0, COUNTDOWN_MS + total - elapsed);
  const secLeft = Math.ceil(msLeft / 1000);

  const timerEl = $('play-timer');
  timerEl.textContent = String(Math.min(secLeft, Math.ceil(total / 1000)));
  timerEl.classList.toggle('low', secLeft <= 10);
  const bar = $('timebar');
  bar.style.width = `${(msLeft / total) * 100}%`;
  bar.classList.toggle('low', secLeft <= 10);

  if (secLeft > 0 && secLeft !== lastTickSecond) {
    lastTickSecond = secLeft;
    if (secLeft <= 5) sndTick();
    else if (secLeft <= 10) sndHeart();
  }

  if (msLeft <= 0) {
    stopTimer();
    sndBuzzer();
    buzz([120, 60, 120]);
    // ONLY the performer's device moves the room to the vote; everyone else is a late
    // fallback in case they dropped. Their anchor starts no earlier than the performer's,
    // so a fallback can never cut a dare short.
    if (isTarget()) finishPerforming();
    else setTimeout(() => { if (room?.state === 'perform') finishPerforming(); }, 4000);
  }
}

// Recomputed on every render so a phone that was asleep, offline or slow snaps to the
// dare the rest of the party is actually watching instead of starting its own.
function refreshAnchor() {
  if (room?.state !== 'perform') { roundAnchor = null; syncedAnchor = false; return; }
  const r = room.round || {};
  if (r.startsAt && r.synced) {
    // Hold the clock rather than guess. A phone that just woke up has no server-clock
    // reading yet and its own clock can be minutes off — guessing would flash a wrong
    // countdown, or instantly time out a dare that just began.
    roundAnchor = clockReady() ? toLocal(r.startsAt) - COUNTDOWN_MS : null;
    syncedAnchor = true;
  } else {
    if (roundAnchor == null || syncedAnchor) roundAnchor = Date.now();
    syncedAnchor = false;
  }
  // tick() stops itself while the anchor is unknown, so it has to be restarted here once
  // the clock arrives — nothing else is watching.
  if (roundAnchor != null && !timerInterval) startTimerLoop();
}

// ---------------------------------------------------------------- rendering
let lastRenderSig = null;

function render() {
  if (!room) return;

  // In fallback mode the heartbeat rewrites the room every few seconds. Redrawing on
  // each one would flicker and fight the user's typing, so any update that changes
  // nothing visible is skipped.
  const { pulseAt, pulseBy, ...meaningful } = room;
  let sig = null;
  try { sig = JSON.stringify(meaningful); } catch { /* unstringifiable — always render */ }
  if (sig !== null && sig === lastRenderSig) { refreshAnchor(); return; }
  lastRenderSig = sig;

  const key = `${room.state}:${room.roundNum || 0}:${room.round?.targetId || ''}`;
  const stateChanged = key !== prevKey;

  if (stateChanged) {
    clearTimeout(overrideTimer);
    hide($('btn-skip-darer'));
    hide($('btn-force-vote'));
    roundAnchor = null;
    nudgeCount = 0;
  }
  refreshAnchor();

  switch (room.state) {
    case 'lobby': renderLobby(); break;
    case 'deal': renderDeal(stateChanged); break;
    case 'decide': renderDecide(stateChanged); break;
    case 'perform': renderPerform(stateChanged); break;
    case 'vote': renderVote(stateChanged); break;
    case 'summary': renderSummary(stateChanged); break;
    case 'gameover': renderGameOver(stateChanged); break;
    default: renderLobby();
  }

  const rx = room.lastReaction;
  if (rx && rx.ts !== seenReactionTs) {
    if (seenReactionTs !== -1) spawnReaction(rx.emoji, rx.name);
    seenReactionTs = rx.ts;
  }

  if (stateChanged) {
    keepAwake(['deal', 'decide', 'perform', 'vote'].includes(room.state));
    if (room.state !== 'perform') stopTimer();
  }
  prevKey = key;
}

function playerRow(id, tag, tagClass = '') {
  const p = room.players[id];
  return `<li class="player-row">
    <span class="p-avatar">${esc(p.avatar || '🙂')}</span>
    <span class="p-name">${esc(p.name)}</span>
    ${tag ? `<span class="p-tag ${tagClass}">${esc(tag)}</span>` : ''}
  </li>`;
}

function renderLobby() {
  showScreen('screen-lobby');
  $('lobby-code').textContent = room.code;
  $('lobby-url').textContent = location.host;
  const joinUrl = `${location.origin}${location.pathname}?join=${room.code}`;
  const qr = $('qr-img');
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=170x170&margin=8&data=${encodeURIComponent(joinUrl)}`;
  if (qr.dataset.src !== qrSrc) {
    qr.src = qrSrc;
    qr.dataset.src = qrSrc;
    // Third-party service — if it's offline or ever goes away, hide the block rather
    // than leave a broken image next to the room code.
    qr.onerror = () => hide($('qr-wrap'));
    qr.onload = () => show($('qr-wrap'));
  }

  const ids = Object.keys(room.players || {}).sort(
    (a, b) => (room.players[a].joinedAt || 0) - (room.players[b].joinedAt || 0)
  );
  $('lobby-count').textContent = `(${ids.length})`;
  $('lobby-players').innerHTML = ids.map((id) => {
    const tag = id === playerId ? 'You' : (id === room.hostId ? 'Host' : '');
    return playerRow(id, tag, id === playerId ? 'you' : '');
  }).join('');

  const host = isHost();
  (host ? show : hide)($('lobby-settings'));
  (host ? hide : show)($('lobby-settings-view'));
  (host ? show : hide)($('btn-start'));
  (host ? hide : show)($('lobby-wait-msg'));

  const s = room.settings || {};
  if (host) {
    renderDeckGrid();
    if (document.activeElement !== $('heat-select')) $('heat-select').value = s.heat || 'medium';
    $('time-select').value = String(s.performSeconds || 60);
    $('target-select').value = String(s.targetScore || 0);
    $('veto-select').value = String(s.vetoes ?? 2);
    $('spicy-toggle').checked = !!s.spicy;
  } else {
    const names = activeDeckIds(s).map((id) => DECKS[id].label).join(', ') || 'None';
    const heatName = { mild: 'Warm Up', medium: 'Standard', wild: 'Unhinged' }[s.heat || 'medium'];
    $('settings-summary').innerHTML = `
      <b>Decks:</b> ${esc(names)}<br>
      <b>How wild:</b> ${esc(heatName)}<br>
      <b>Play to:</b> ${s.targetScore ? `${s.targetScore} points` : 'no limit'}<br>
      <b>Vetoes:</b> ${s.vetoes === 99 ? 'unlimited' : (s.vetoes ?? 2)} each
      ${s.spicy ? '<br><b>🌶️ Adult decks are ON</b>' : ''}`;
  }
}

function renderDeckGrid() {
  const s = room.settings || {};
  const on = new Set(s.decks || []);
  const ids = [...CLEAN_DECKS, ...SPICY_DECKS];
  $('deck-grid').innerHTML = ids.map((id) => {
    const d = DECKS[id];
    const locked = d.spicy && !s.spicy;
    return `<button class="deck-chip${on.has(id) && !locked ? ' on' : ''}${locked ? ' locked' : ''}" data-deck="${esc(id)}">
      ${esc(d.label)}${locked ? ' 🔒' : ''}
      <span class="dc-blurb">${esc(d.blurb)}</span>
    </button>`;
  }).join('');
  for (const b of $('deck-grid').querySelectorAll('.deck-chip')) {
    b.addEventListener('click', () => toggleDeck(b.dataset.deck));
  }
}

async function toggleDeck(id) {
  if (!isHost()) return;
  const s = room.settings || {};
  if (DECKS[id]?.spicy && !s.spicy) return toast('Turn on adult decks below first.');
  const set = new Set(s.decks || []);
  if (set.has(id)) set.delete(id); else set.add(id);
  if (!set.size) return toast('Keep at least one deck on!');
  try { await updateDoc(roomRef, { 'settings.decks': [...set] }); } catch { /* fine */ }
}

function renderDeal(stateChanged) {
  showScreen('screen-deal');
  const r = room.round;
  $('deal-round').textContent = `ROUND ${room.roundNum || 1}`;
  $('deal-darer').textContent = nameOf(r.darerId);
  $('deal-target').textContent = nameOf(r.targetId);

  const mine = isDarer();
  (mine ? show : hide)($('deal-picker'));
  (mine ? hide : show)($('deal-wait-msg'));

  if (mine) {
    if (stateChanged) buzz([40, 50, 40]);
    $('deal-choices').innerHTML = (r.choices || []).map((c, i) => `
      <button class="deal-choice" data-i="${i}">
        <div class="dare-meta">
          <span class="dare-deck">${esc(DECKS[c.deck]?.label || '')}</span>
          <span class="dare-heat">${heatStars(c.heat)} ${esc(HEAT_LABEL[c.heat])}</span>
        </div>
        <p class="dare-text small">${esc(c.t)}</p>
        <p class="dare-worth">Worth ${POINTS[c.heat] || 2} points</p>
      </button>`).join('');
    for (const b of $('deal-choices').querySelectorAll('.deal-choice')) {
      b.addEventListener('click', () => chooseDare(Number(b.dataset.i)));
    }
  } else {
    // Drop the previous round's cards rather than leave them sitting in the hidden
    // container — nobody should be one CSS slip away from picking a stale dare.
    $('deal-choices').innerHTML = '';
    $('deal-wait-msg').textContent = `${plainName(r.darerId)} is picking a dare for ${plainName(r.targetId)}… 😈`;
  }

  // If the darer's phone is face-down on a table somewhere, let the room move on.
  if (stateChanged && !mine) {
    overrideTimer = setTimeout(() => {
      if (room?.state === 'deal' && isHost()) show($('btn-skip-darer'));
    }, 20000);
  }
}

function renderDecide(stateChanged) {
  showScreen('screen-decide');
  const r = room.round;
  const d = r.dare || {};
  $('decide-darer').textContent = nameOf(r.darerId);
  $('decide-target').textContent = nameOf(r.targetId);
  $('decide-deck').textContent = DECKS[d.deck]?.label || '';
  $('decide-heat').textContent = `${heatStars(d.heat || 1)} ${HEAT_LABEL[d.heat] || ''}`;
  $('decide-text').textContent = d.t || '';
  $('decide-worth').textContent = `Worth ${darePoints(r)} points`;
  (r.bounced ? show : hide)($('decide-bounced'));

  const mine = isTarget();
  (mine ? show : hide)($('decide-buttons'));
  (mine ? hide : show)($('decide-wait-msg'));

  if (mine) {
    if (stateChanged) buzz([60, 60, 60, 60, 120]);
    const vetoes = meRec().vetoesLeft ?? 0;
    const unlimited = (room.settings?.vetoes ?? 2) === 99;
    $('veto-count').textContent = unlimited ? '' : `(${vetoes} left)`;
    ($('btn-veto')).disabled = !unlimited && vetoes <= 0;
    $('btn-veto').style.opacity = (!unlimited && vetoes <= 0) ? '0.4' : '';
    const canBounce = !r.bounced && (meRec().bouncesLeft ?? 0) > 0;
    (canBounce ? show : hide)($('btn-bounce'));
  } else {
    $('decide-wait-msg').textContent = `${plainName(r.targetId)} is deciding… 👀`;
  }
}

function renderPerform(stateChanged) {
  showScreen('screen-perform');
  const r = room.round;
  const d = r.dare || {};
  $('perform-deck').textContent = DECKS[d.deck]?.label || '';
  $('perform-heat').textContent = `${heatStars(d.heat || 1)} ${HEAT_LABEL[d.heat] || ''}`;
  $('perform-text').textContent = d.t || '';
  $('perform-worth').textContent = `Worth ${darePoints(r)} points`;
  $('play-who').textContent = `${nameOf(r.targetId)} is up`;

  const mine = isTarget();
  (mine ? show : hide)($('perform-mine'));
  (mine ? hide : show)($('perform-watch-msg'));
  (mine ? hide : show)($('reaction-bar'));

  if (stateChanged) {
    if (mine) buzz([200, 80, 200]);
    if (soundOn()) unlockAudio();
  }
}

function renderVote(stateChanged) {
  showScreen('screen-vote');
  const r = room.round;
  $('vote-sub').textContent = `${plainName(r.targetId)} took on a ${HEAT_LABEL[r.dare?.heat] || ''} dare for ${darePoints(r)} points.`;
  $('vote-text').textContent = r.dare?.t || '';

  const voters = voterIds();
  const votes = r.votes || {};
  const cast = voters.filter((id) => id in votes);
  $('vote-count').textContent = `(${cast.length}/${voters.length})`;
  $('vote-list').innerHTML = voters.map((id) =>
    playerRow(id, id in votes ? 'Voted' : 'Waiting…', id in votes ? 'voted' : '')
  ).join('');

  const canVote = !isTarget() && !(playerId in votes);
  (canVote ? show : hide)($('vote-buttons'));
  (canVote ? hide : show)($('vote-wait-msg'));
  $('vote-wait-msg').textContent = isTarget()
    ? 'The room is deciding your fate… 😬'
    : 'Vote locked in — waiting for everyone else…';

  if (stateChanged && canVote) buzz([40, 40, 40]);

  // Everyone has spoken — the resolver tallies it up immediately.
  if (isResolver() && voters.length && cast.length >= voters.length) resolveVotes();

  if (stateChanged) {
    overrideTimer = setTimeout(() => {
      if (room?.state === 'vote' && isResolver()) show($('btn-force-vote'));
    }, 12000);
  }
}

const OUTCOMES = {
  nailed:  { cls: 'good', text: '🔥 NAILED IT!' },
  weak:    { cls: 'meh',  text: '💩 Weak Sauce…' },
  chicken: { cls: 'bad',  text: '🐔 CHICKENED OUT' },
  veto:    { cls: 'meh',  text: '🛡️ Vetoed — no harm done' },
  skipped: { cls: 'meh',  text: '⏭ Dare skipped' },
  left:    { cls: 'meh',  text: '🚪 They left mid-dare' },
};

function renderSummary(stateChanged) {
  showScreen('screen-summary');
  const r = room.round || {};
  const o = OUTCOMES[r.outcome] || OUTCOMES.skipped;
  $('summary-round').textContent = `ROUND ${room.roundNum || 1}`;
  const banner = $('outcome-banner');
  banner.textContent = o.text;
  banner.className = `outcome-banner ${o.cls}`;

  const who = plainName(r.targetId);
  let headline = '';
  if (r.outcome === 'nailed' || r.outcome === 'weak') {
    const t = r.tally || {};
    headline = `${esc(who)} scored <b>+${r.awarded}</b> — ${t.yes || 0} said nailed it, ${t.no || 0} said weak sauce.`;
  } else if (r.outcome === 'chicken') {
    headline = `${esc(who)} lost a point. ${esc(plainName(r.darerId))} gets one for the trouble.`;
  } else if (r.outcome === 'veto') {
    headline = `${esc(who)} used a veto. No points, no penalty, no questions.`;
  } else if (r.outcome === 'left') {
    headline = 'The dare was abandoned.';
  } else {
    headline = 'The room moved on.';
  }
  $('summary-headline').innerHTML = headline;

  (r.punishment ? show : hide)($('punishment-card'));
  if (r.punishment) $('punishment-text').textContent = r.punishment;

  renderScoreList($('summary-scores'));

  const canAdvance = isHost() || isDarer();
  (canAdvance ? show : hide)($('summary-host-panel'));
  (canAdvance ? hide : show)($('summary-wait-msg'));
  $('summary-wait-msg').textContent = 'Waiting for the next dare…';
  $('btn-next-round').textContent = targetReached() ? '🏁 See Final Scores' : '⏭ Next Dare';

  if (stateChanged) {
    if (r.outcome === 'nailed') { sndGood(); confettiBurst(70, 2200); }
    else if (r.outcome === 'chicken') sndChicken();
    else if (r.outcome === 'weak') sndBad();
  }
}

function rankedPlayers() {
  return Object.entries(room.players || {})
    .map(([id, p]) => ({ id, ...p }))
    .sort((a, b) => (b.score || 0) - (a.score || 0) || a.name.localeCompare(b.name));
}

function renderScoreList(el) {
  const r = room.round || {};
  el.innerHTML = rankedPlayers().map((p, i) => {
    let delta = '';
    if (r.outcome && p.id === r.targetId && r.awarded) {
      const up = r.awarded > 0;
      delta = `<span class="s-delta ${up ? 'up' : 'down'}">${up ? '+' : ''}${r.awarded}</span>`;
    } else if (r.outcome === 'chicken' && p.id === r.darerId) {
      delta = '<span class="s-delta up">+1</span>';
    }
    return `<li class="score-row">
      <span class="s-rank">${i + 1}</span>
      <span class="p-avatar">${esc(p.avatar || '🙂')}</span>
      <span class="s-name">${esc(p.name)}${p.id === playerId ? ' (you)' : ''}</span>
      <span class="s-pts">${p.score || 0}</span>${delta}
    </li>`;
  }).join('');
}

function renderGameOver(stateChanged) {
  showScreen('screen-gameover');
  const ranked = rankedPlayers();
  const winner = ranked[0];
  $('gameover-headline').innerHTML = winner
    ? `👑 <b>${esc(winner.name)}</b> wins with ${winner.score || 0} points!`
    : 'Game over!';
  renderScoreList($('final-scores'));
  renderAwards();

  (isHost() ? show : hide)($('btn-play-again'));
  (isHost() ? hide : show)($('gameover-wait-msg'));

  if (stateChanged) { sndFanfare(); confettiBurst(150, 3200); }
}

function renderAwards() {
  const players = Object.entries(room.players || {}).map(([id, p]) => ({ id, ...p }));
  const best = (field) => {
    const top = players.filter((p) => (p[field] || 0) > 0)
      .sort((a, b) => (b[field] || 0) - (a[field] || 0))[0];
    return top ? { name: top.name, n: top[field] } : null;
  };
  const rows = [];
  const daring = best('accepts');
  if (daring) rows.push(`😈 <b>Most Daring</b> — ${esc(daring.name)} took on ${daring.n} dare${daring.n === 1 ? '' : 's'}`);
  const crowd = best('nailed');
  if (crowd) rows.push(`🔥 <b>Crowd Pleaser</b> — ${esc(crowd.name)} nailed ${crowd.n} of them`);
  const evil = best('heatDealt');
  if (evil) rows.push(`🎯 <b>Evil Genius</b> — ${esc(evil.name)} dealt the nastiest cards`);
  const chicken = best('chickens');
  if (chicken) rows.push(`🐔 <b>Chicken Dinner</b> — ${esc(chicken.name)} bailed ${chicken.n} time${chicken.n === 1 ? '' : 's'}`);
  const safe = best('vetoed');
  if (safe) rows.push(`🛡️ <b>Played It Safe</b> — ${esc(safe.name)} vetoed ${safe.n}`);

  $('awards').innerHTML = rows.length
    ? rows.map((r) => `<li>${r}</li>`).join('')
    : '<li>Nobody did anything worth an award. Bold strategy.</li>';
  (rows.length ? show : hide)($('awards-card'));
}

// ---------------------------------------------------------------- settings sync
function syncSetting(field, value) {
  if (!isHost() || !roomRef) return;
  updateDoc(roomRef, { [`settings.${field}`]: value }).catch(() => {});
}

// ---------------------------------------------------------------- avatar picker
function renderAvatarPicker() {
  $('avatar-picker').innerHTML = AVATARS.map((a) =>
    `<button class="avatar-opt${a === myAvatar ? ' selected' : ''}" data-a="${esc(a)}">${esc(a)}</button>`
  ).join('');
  for (const b of $('avatar-picker').querySelectorAll('.avatar-opt')) {
    b.addEventListener('click', () => {
      myAvatar = b.dataset.a;
      localStorage.setItem('dares_avatar', myAvatar);
      $('avatar-btn').textContent = myAvatar;
      renderAvatarPicker();
      if (roomRef && room?.players?.[playerId]) {
        updateDoc(roomRef, { [`players.${playerId}.avatar`]: myAvatar }).catch(() => {});
      }
    });
  }
}

// ---------------------------------------------------------------- misc actions
async function fullRefresh() {
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch { /* best effort — reload anyway */ }
  location.reload();
}

async function shareApp() {
  const base = location.origin + location.pathname;
  const inRoom = room && roomCode;
  const url = inRoom ? `${base}?join=${roomCode}` : base;
  const data = {
    title: 'Dares Gone Wild',
    text: inRoom
      ? `Join my Dares Gone Wild room! Code: ${roomCode}`
      : 'Play Dares Gone Wild with me — the party dare game!',
    url,
  };
  try {
    if (navigator.share) await navigator.share(data);
    else { await navigator.clipboard.writeText(`${data.text} ${url}`); toast('Link copied!'); }
  } catch { /* user cancelled the share sheet — fine */ }
}

// ---------------------------------------------------------------- wiring
$('name-input').value = localStorage.getItem('dares_name') || '';
$('avatar-btn').textContent = myAvatar;
$('version-label').textContent = `v${APP_VERSION}`;
$('about-version').textContent = `Version ${APP_VERSION}`;

$('avatar-btn').addEventListener('click', () => { renderAvatarPicker(); show($('avatar-modal')); });
$('btn-avatar-close').addEventListener('click', () => hide($('avatar-modal')));
$('btn-create').addEventListener('click', createRoom);
$('btn-join').addEventListener('click', joinRoom);
$('code-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });
$('btn-howto').addEventListener('click', () => show($('howto-modal')));
$('btn-howto-close').addEventListener('click', () => hide($('howto-modal')));
$('btn-about-close').addEventListener('click', () => hide($('about-modal')));
$('btn-theme-close').addEventListener('click', () => hide($('theme-modal')));

$('btn-start').addEventListener('click', startGame);
$('btn-leave-lobby').addEventListener('click', () => leaveRoom());
$('btn-leave-game').addEventListener('click', () => leaveRoom());

$('heat-select').addEventListener('change', (e) => syncSetting('heat', e.target.value));
$('time-select').addEventListener('change', (e) => syncSetting('performSeconds', Number(e.target.value)));
$('target-select').addEventListener('change', (e) => syncSetting('targetScore', Number(e.target.value)));
$('veto-select').addEventListener('change', (e) => {
  const n = Number(e.target.value);
  syncSetting('vetoes', n);
  // Nobody has spent a veto yet in the lobby, so top everyone up to the new allowance.
  if (isHost() && room?.state === 'lobby') {
    const updates = {};
    for (const id of Object.keys(room.players || {})) updates[`players.${id}.vetoesLeft`] = n;
    updateDoc(roomRef, updates).catch(() => {});
  }
});

// The 18+ decks need a deliberate confirmation, never an accidental tap.
$('spicy-toggle').addEventListener('change', (e) => {
  if (e.target.checked) {
    e.target.checked = false; // stays off until the gate is accepted
    show($('age-modal'));
  } else {
    const keep = (room?.settings?.decks || []).filter((id) => !DECKS[id]?.spicy);
    updateDoc(roomRef, {
      'settings.spicy': false,
      'settings.decks': keep.length ? keep : ['party'],
    }).catch(() => {});
  }
});
$('btn-age-yes').addEventListener('click', () => {
  hide($('age-modal'));
  syncSetting('spicy', true);
  toast('🌶️ Adult decks unlocked — turn them on above');
});
$('btn-age-no').addEventListener('click', () => hide($('age-modal')));

$('btn-accept').addEventListener('click', acceptDare);
$('btn-bounce').addEventListener('click', bounceDare);
$('btn-chicken').addEventListener('click', chickenOut);
$('btn-veto').addEventListener('click', vetoDare);
$('btn-done').addEventListener('click', finishPerforming);
$('btn-nailed').addEventListener('click', () => castVote(true));
$('btn-weak').addEventListener('click', () => castVote(false));
$('btn-force-vote').addEventListener('click', resolveVotes);
$('btn-next-round').addEventListener('click', nextRound);
$('btn-end-game').addEventListener('click', endGame);
$('btn-play-again').addEventListener('click', playAgain);
$('btn-skip-darer').addEventListener('click', () => chooseDare(0));

for (const b of document.querySelectorAll('.reaction-btn')) {
  b.addEventListener('click', () => sendReaction(b.dataset.emoji));
}

$('btn-menu').addEventListener('click', (e) => {
  e.stopPropagation();
  const inRoom = !!room;
  (inRoom ? show : hide)($('menu-leave'));
  const mid = inRoom && isHost() && ['deal', 'decide', 'perform', 'vote'].includes(room.state);
  (mid ? show : hide)($('menu-skip'));
  ((inRoom && isHost() && room.state !== 'lobby' && room.state !== 'gameover') ? show : hide)($('menu-endgame'));
  $('menu-sound').textContent = `🔊 Sounds: ${soundOn() ? 'On' : 'Off'}`;
  $('menu-dropdown').classList.toggle('hidden');
});
document.addEventListener('click', (e) => {
  if (!$('menu-wrap').contains(e.target)) hide($('menu-dropdown'));
});
$('menu-refresh').addEventListener('click', fullRefresh);
$('menu-share').addEventListener('click', () => { hide($('menu-dropdown')); shareApp(); });
$('menu-themes').addEventListener('click', () => { hide($('menu-dropdown')); openThemes(); });
$('menu-about').addEventListener('click', () => { hide($('menu-dropdown')); show($('about-modal')); });
$('menu-skip').addEventListener('click', () => { hide($('menu-dropdown')); skipDare(); });
$('menu-endgame').addEventListener('click', () => { hide($('menu-dropdown')); endGame(); });
$('menu-leave').addEventListener('click', () => { hide($('menu-dropdown')); leaveRoom(); });
$('menu-sound').addEventListener('click', () => {
  localStorage.setItem('dares_sound', soundOn() ? 'off' : 'on');
  $('menu-sound').textContent = `🔊 Sounds: ${soundOn() ? 'On' : 'Off'}`;
  if (soundOn()) {
    unlockAudio(); // this tap is the user gesture iOS requires
    sndGood();
    toast('Sounds on 🔊');
  } else {
    toast('Sounds off 🔇');
  }
});

$('btn-update').addEventListener('click', fullRefresh);

// ---------------------------------------------------------------- install
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  updateInstallBanner();
});

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}
function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}
function updateInstallBanner() {
  const dismissed = localStorage.getItem('dares_install_dismissed');
  const canShow = !isStandalone() && !dismissed && (deferredPrompt || isIOS())
    && !$('screen-home').classList.contains('hidden');
  (canShow ? show : hide)($('install-banner'));
}
$('btn-install').addEventListener('click', async () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    hide($('install-banner'));
  } else {
    show($('ios-install-modal'));
  }
});
$('btn-install-dismiss').addEventListener('click', () => {
  localStorage.setItem('dares_install_dismissed', '1');
  hide($('install-banner'));
});
$('btn-ios-close').addEventListener('click', () => hide($('ios-install-modal')));
updateInstallBanner();

// ---------------------------------------------------------------- update check
async function checkForUpdate() {
  try {
    const res = await fetch(`version.js?nocache=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const m = (await res.text()).match(/APP_VERSION\s*=\s*'([^']+)'/);
    if (m && m[1] !== APP_VERSION) show($('update-banner'));
  } catch { /* offline — skip */ }
}
checkForUpdate();

// Installed PWAs are resumed, not reloaded — re-check when the app comes back to the
// foreground (at most every 10 minutes) so no phone stays on an old version for days.
let lastUpdateCheck = Date.now();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - lastUpdateCheck > 600000) {
    lastUpdateCheck = Date.now();
    checkForUpdate();
  }
});

// ---------------------------------------------------------------- boot
const joinParam = new URLSearchParams(location.search).get('join');
const savedRoom = localStorage.getItem('dares_room');
if (joinParam && /^[A-Za-z]{4}$/.test(joinParam)) {
  history.replaceState(null, '', location.pathname);
  $('code-input').value = joinParam.toUpperCase();
  if (myName()) joinRoom();
  else toast(`Enter your name, then tap Join for room ${joinParam.toUpperCase()}!`);
} else if (savedRoom) {
  // auto-rejoin a room we were already in (e.g. an accidental refresh)
  withTimeout(getDoc(doc(db, 'rooms', savedRoom)), 8000).then((snap) => {
    if (snap.exists() && !roomIsStale(snap.data()) && snap.data().players?.[playerId]) {
      enterRoom(savedRoom);
    } else {
      localStorage.removeItem('dares_room');
    }
  }).catch(() => {});
}

// ---------------------------------------------------------------- PWA
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(`sw.js?v=${APP_VERSION}`).catch(() => {});
}
