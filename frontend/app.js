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
const video2 = document.getElementById("video2");
const prevVideoBtn = document.getElementById("prevVideo");
const nextVideoBtn = document.getElementById("nextVideo");
const startBtn = document.getElementById("start");
const stopBtn = document.getElementById("stop");
const statusEl = document.getElementById("status");
const txtEl = document.getElementById("txt");
const qEl = document.getElementById("q");

// Current video element reference
let currentVideoElement = video;

// Initialize video display - show first video, hide second
video.style.display = 'block';
video2.style.display = 'none';

// Function to switch to the next video
function switchToNextVideo() {
  // Pause current video
  currentVideoElement.pause();
  
  // Toggle between the two video elements
  if (currentVideoElement === video) {
    currentVideoElement = video2;
    video.style.display = 'none';
    video2.style.display = 'block';
  } else {
    currentVideoElement = video;
    video.style.display = 'block';
    video2.style.display = 'none';
  }
  
  // Ensure the video is muted and plays
  currentVideoElement.muted = true;
  currentVideoElement.currentTime = 0; // Reset to beginning
  currentVideoElement.play();
}

// Function to switch to the previous video
function switchToPrevVideo() {
  // Pause current video
  currentVideoElement.pause();
  
  // Toggle between the two video elements
  if (currentVideoElement === video) {
    currentVideoElement = video2;
    video.style.display = 'none';
    video2.style.display = 'block';
  } else {
    currentVideoElement = video;
    video.style.display = 'block';
    video2.style.display = 'none';
  }
  
  // Ensure the video is muted and plays
  currentVideoElement.muted = true;
  currentVideoElement.currentTime = 0; // Reset to beginning
  currentVideoElement.play();
}

let recognition = null;
let isListening = false;
let lastAskedAt = -Infinity;
let latestText = "";
let lastSpeechAt = Date.now() / 1000;
let contextBuffer = [];
let analyzeTimer = null;

// ### TEXT-TO-SPEECH ###
function speakText(text) {
  if ('speechSynthesis' in window) {
    // Cancel any ongoing speech
    speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    
    // Choose a natural voice
    const voices = speechSynthesis.getVoices();
    const englishVoice = voices.find(v => v.lang.includes('en') && v.localService);
    if (englishVoice) {
      utterance.voice = englishVoice;
    }
    
    speechSynthesis.speak(utterance);
  }
}

// Load voices when they're available
window.speechSynthesis.onvoiceschanged = () => {
  speechSynthesis.getVoices();
};

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
  r.interimResults = true;
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

    latestText = final || interim || latestText;
    txtEl.textContent = latestText || "—";

    if (final) {
      contextBuffer.push(final);
      if (contextBuffer.length > 4) contextBuffer.shift();
    }
  };

  r.onerror = (e) => {
    statusEl.textContent = `error: ${e.error}`;
    console.error("Speech error:", e);
  };

  r.onend = () => {
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
async function callAnalyzeAPI(utterance, extras = {}) {
  try {
    const res = await fetch(`${API_BASE}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: "demo",
        time_sec: video ? (video.currentTime || 0) : 0,
        utterance,
        ...extras
      })
    });

    const data = await res.json();
    qEl.textContent = data.question;
    
    // SPEAK THE QUESTION
    if (data.question && data.question !== "—") {
      speakText(data.question);
    }

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

// Event listeners for the video navigation buttons
nextVideoBtn.addEventListener("click", switchToNextVideo);
prevVideoBtn.addEventListener("click", switchToPrevVideo);