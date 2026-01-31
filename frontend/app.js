// ---- Configure your API base URL ----
const API_BASE = "http://localhost:8000";

// ---- Your timestamps (seconds) ----
// 2:40, 2:49, 6:55, 7:38, 8:25, 10:05, 10:12, 10:18
const MOMENTS = [
  2*60 + 40,
  2*60 + 49,
  6*60 + 55,
  7*60 + 38,
  8*60 + 25,
  10*60 + 5,
  10*60 + 12,
  10*60 + 18
];

// window size around each moment (seconds)
// ex: allow AI asking from 3 seconds before to 6 seconds after
const WINDOW_BEFORE = 3;
const WINDOW_AFTER = 6;

// ask a question once every X seconds
const COOLDOWN_SEC = 15;
const ANALYZE_EVERY_SEC = 10;

const video = document.getElementById("video");
const startBtn = document.getElementById("start");
const stopBtn = document.getElementById("stop");
const statusEl = document.getElementById("status");
const tEl = document.getElementById("t");
const txtEl = document.getElementById("txt");
const catEl = document.getElementById("cat");
const scoreEl = document.getElementById("score");
const qEl = document.getElementById("q");

let recognition = null;
let isListening = false;
let lastAskedAt = -Infinity;
let lastTranscript = "";
let latestText = "";      // latest interim/final text
let lastSpeechAt = Date.now() / 1000;
let contextBuffer = [];   // for story context
let analyzeTimer = null;

// ### TIMING HELPERS ###
function inMomentWindow(currentTime) {
  return MOMENTS.some(m => currentTime >= (m - WINDOW_BEFORE) && currentTime <= (m + WINDOW_AFTER));
}

function canAskNow() {
  const now = Date.now() / 1000;
  return (now - lastAskedAt) >= COOLDOWN_SEC;
}

// ### SPEECH RECOGNITION ###
function setupRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    alert("Speech recognition not supported. Use Chrome on desktop.");
    return null;
  }

  const r = new SR();
  r.continuous = true;
  r.interimResults = true; // ✅ makes transcript feel live
  r.lang = "en-US";

  r.onresult = (event) => {
    const now = Date.now() / 1000;
    const gapSec = now - lastSpeechAt;
    lastSpeechAt = now;

    let interim = "";
    let final = "";

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const res = event.results[i];
      const txt = (res[0].transcript || "").trim();
      if (!txt) continue;

      if (res.isFinal) final += (final ? " " : "") + txt;
      else interim += (interim ? " " : "") + txt;
    }

    // ✅ Always show something
    latestText = final || interim || latestText;
    txtEl.textContent = latestText || "—";

    // Save FINAL lines to story context (so questions match the story)
    if (final) {
      contextBuffer.push(final);
      if (contextBuffer.length > 4) contextBuffer.shift();
    }

    // (No API call here — we call on a timer so it works even with no pauses)
  };

  r.onerror = (e) => {
    statusEl.textContent = `error: ${e.error}`;
    console.error("Speech error:", e);
  };

  r.onend = () => {
    // Chrome may stop recognition randomly
    console.warn("Recognition ended");
    if (isListening) {
      try { r.start(); } catch {}
    } else {
      statusEl.textContent = "stopped";
      startBtn.disabled = false;
      stopBtn.disabled = true;
    }
  };

  return r;
}

// ### API CALL ###
// Update callAnalyzeAPI to accept extra fields
async function callAnalyzeAPI(utterance, extras = {}) {
  try {
    const res = await fetch(`${API_BASE}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: "demo",
        time_sec: video ? (video.currentTime || 0) : 0, // ok if video unused
        utterance,
        ...extras
      })
    });

    const data = await res.json();
    catEl.textContent = data.category;
    scoreEl.textContent = String(data.score);
    qEl.textContent = data.question;

    lastAskedAt = Date.now() / 1000;
  } catch (err) {
  statusEl.textContent = "API error (check console)";
  console.error("API call failed:", err);
  }
}

function startAnalyzeLoop() {
  stopAnalyzeLoop();

  analyzeTimer = setInterval(async () => {
    if (!isListening) return;
    if (!latestText || latestText.trim().length < 10) return;
    if (!canAskNow()) return;

    const recentContext = contextBuffer.join(" | ");
    const gapSec = (Date.now() / 1000) - lastSpeechAt;

    await callAnalyzeAPI(latestText.trim(), {
      gap_sec: gapSec,
      recent_context: recentContext
    });

    lastAskedAt = Date.now() / 1000;
  }, ANALYZE_EVERY_SEC * 1000);
}

function stopAnalyzeLoop() {
  if (analyzeTimer) {
    clearInterval(analyzeTimer);
    analyzeTimer = null;
  }
}

// ### UI EVENTS ###
video.addEventListener("timeupdate", () => {
  tEl.textContent = (video.currentTime || 0).toFixed(1);
});

startBtn.addEventListener("click", async () => {
  if (!recognition) recognition = setupRecognition();
  if (!recognition) return;

  isListening = true;
  startAnalyzeLoop();

  try {
    recognition.start();
  } catch {}

  statusEl.textContent = "listening";
  startBtn.disabled = true;
  stopBtn.disabled = false;
});

stopBtn.addEventListener("click", () => {
  isListening = false;
  stopAnalyzeLoop();

  if (recognition) recognition.stop();

  statusEl.textContent = "stopped";
  startBtn.disabled = false;
  stopBtn.disabled = true;
});