// Scan feedback (audio + haptic), shared across the scan surfaces.
// A chime when a scan resolves to a product, a buzz when it doesn't. The chime
// is a real bell struck off the brand intro sting (public/sounds/match-chime.mp3),
// decoded once into an AudioBuffer; a synthesized two-note chime is the fallback
// if the asset can't load. The shared AudioContext is unlocked + the clip
// preloaded on the first user tap (iOS needs a gesture before WebAudio makes
// sound). Vibration uses the Web Vibration API — works on Android; iOS Safari
// has never implemented it, so the buzz is a silent no-op there.
//
// Module-level state is shared by every importer, so the reorder scanner
// (page.jsx) and the receiving/shelf-audit scanner (scansessions.jsx) all play
// off the same unlocked context — the gesture priming lives in page.jsx, which
// is always mounted.
const MATCH_CHIME_URL = "/sounds/match-chime.mp3";
let scanAudioCtx = null;
let matchChimeBuffer = null;   // decoded clip, cached after first load
let matchChimeLoading = false;

export function getScanAudioCtx() {
  if (typeof window === "undefined") return null;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!scanAudioCtx) {
    try { scanAudioCtx = new Ctx(); } catch { return null; }
  }
  return scanAudioCtx;
}

// Fetch + decode the chime once. Safe to call repeatedly; no-ops once cached or
// in flight. decodeAudioData needs a context, so this runs after one exists.
export function loadMatchChime(ctx) {
  if (matchChimeBuffer || matchChimeLoading || !ctx || typeof fetch === "undefined") return;
  matchChimeLoading = true;
  fetch(MATCH_CHIME_URL)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((buf) => ctx.decodeAudioData(buf))
    .then((decoded) => { matchChimeBuffer = decoded; })
    .catch(() => {})            // asset missing/undecodable — synth fallback covers it
    .finally(() => { matchChimeLoading = false; });
}

function playSynthChime(ctx) {
  const t0 = ctx.currentTime;
  // Quick rising "ding-dong" (B5 → E6) that reads as a positive confirmation.
  for (const [freq, offset] of [[988, 0], [1319, 0.11]]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const start = t0 + offset;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.24);
  }
}

export function playMatchChime() {
  const ctx = getScanAudioCtx();
  if (!ctx) return;
  try {
    if (ctx.state === "suspended") ctx.resume();
    if (matchChimeBuffer) {
      const src = ctx.createBufferSource();
      src.buffer = matchChimeBuffer;
      const gain = ctx.createGain();
      gain.gain.value = 0.9;
      src.connect(gain).connect(ctx.destination);
      src.start();
      return;
    }
    // Not decoded yet — start loading for next time, sound the synth for now.
    loadMatchChime(ctx);
    playSynthChime(ctx);
  } catch {
    // audio unavailable — stay silent
  }
}

export function vibrateNoMatch() {
  try {
    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate([90, 60, 90]);
  } catch {
    // Web Vibration API unsupported (e.g. iOS Safari) — no-op
  }
}
