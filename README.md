# Dares Gone Wild 😈🔥

A room-synced party dare game as an installable PWA. Everyone joins on their own phone
with a 4-letter room code. One player deals a dare, another has to decide whether to do
it — and then the room votes on whether they actually pulled it off.

## The loop

1. **Deal** — the Darer sees two dare cards and picks one for a randomly chosen Target.
2. **Decide** — the Target can **Accept**, **Dare Back** (swaps roles, doubles the stakes,
   once per player per game), **Chicken Out** (−1 point, +1 to the Darer, plus a
   punishment card), or **Veto** (free, no penalty, no explanation — 2 per game).
3. **Perform** — a server-synced clock runs while they do it. Everyone else can react.
4. **Vote** — everyone except the Target votes Nailed It or Weak Sauce. A tie goes to the
   performer.
5. **Score** — Nailed It pays full value, Weak Sauce pays half. Heat 1→1pt, 2→2, 3→3,
   4→5, 5→8. Bounced dares are worth double.

Awards at the end: Most Daring, Crowd Pleaser, Evil Genius, Chicken Dinner, Played It Safe.

## Decks

Seven clean decks (Party Starter, Center Stage, Physical Challenge, Phone & Social,
Cringe Zone, Whole Room, Chaos) plus two adult decks (Spicy, Couples) behind an 18+
confirmation the host has to accept deliberately. Every player keeps their free vetoes
regardless of deck.

The host also sets **How wild?** — Warm Up deals heat 1–3, Standard 2–4, Unhinged 3–5.

## Stack

Vanilla JS, no build step. Everything ships from `public/`:

| File | What it is |
| --- | --- |
| `app.js` | the whole app — sync layer, game flow, rendering |
| `dares.js` | all dare decks + punishment cards |
| `wordcodes.js` | 928 four-letter words used as room codes |
| `version.js` | `APP_VERSION` — **bump on every change** (`YYYY.MM.DD.NN`) |
| `sw.js` | service worker, network-first with cache fallback |

Firebase project **`dares-gone-wild-0490`** (Firestore only). Collections:
`rooms/{4-LETTER-CODE}` and `pulses/{4-LETTER-CODE}` (heartbeat).

## Room sync

Rounds are timed in **server** time, not per-device time. One device heartbeats
`at: serverTimestamp()` into `pulses/{code}` every ~4s; each phone derives its own clock
offset from that heartbeat, so every phone lands on the same instant even when their own
clocks disagree by minutes. That same cadence is the liveness signal behind an escalating
reconnect ladder: resubscribe → `getDocFromServer` → `disableNetwork`/`enableNetwork`.

The heartbeat lives in its own tiny document on purpose — Firestore re-sends a whole
document to every listener on any change, so beating inside the room would rebroadcast
the entire game state every few seconds.

If sync ever misbehaves, check the heartbeat first.

## Local development

```bash
python -m http.server 5204 --directory public
```

There's a `dares` entry in `../.claude/launch.json` that does the same thing. To test two
players locally, open the second tab on `127.0.0.1` instead of `localhost` — a different
origin means separate `localStorage`, hence a separate player id.

Regenerate the icons after changing the artwork:

```bash
node scripts/build-icons.mjs
```

## Deploying

**Live at https://androidbill.github.io/dares-gone-wild/** — `.github/workflows/pages.yml`
publishes `public/` to GitHub Pages on every push to `main` (~40s). Nothing to run by hand.

Firestore rules are **not** covered by that workflow — deploy them separately whenever
`firestore.rules` changes:

```bash
firebase deploy --only firestore:rules --project dares-gone-wild-0490
```

Firebase is used for Firestore **only** — there is deliberately no `hosting` block in
`firebase.json`, so a bare `firebase deploy` can't stand up a second, stale copy of the
app alongside the Pages one.
