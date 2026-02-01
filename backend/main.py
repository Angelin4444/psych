# ### BACKEND API (FastAPI) ###
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import re
import time
import random

app = FastAPI()

# Allow your frontend to call the API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------- Trigger dictionary ----------
TRIGGERS = {
    "safety": {
        "patterns": [
            (r"\b(can't breathe|cant breathe|panic|panicking|freaking out)\b", 5),
            (r"\b(too much|overwhelming|stop|pause|i want to leave|i need to leave)\b", 4),
            (r"\b(shaking|trembling|heart racing|dizzy|nauseous)\b", 3),
        ],
    },
    "evaluation_fear": {
        "patterns": [
            (r"\b(judge|judging|staring|watching|embarrassed|awkward)\b", 2),
            (r"\b(what will they think|people think|everyone thinks|laugh at me|make fun of me)\b", 4),
            (r"\b(they're looking at me|they are looking at me)\b", 4),
        ],
    },
    "avoidance": {
        "patterns": [
            (r"\b(i didn't tell|i never told|i kept it to myself|i hid it)\b", 4),
            (r"\b(i avoided|i try to avoid|i stayed quiet|i didn’t speak)\b", 4),
            (r"\b(i don't want to talk|i can't say it)\b", 4),
        ],
    },
    "somatic": {
        "patterns": [
            (r"\b(shaking|sweating|blushing|heart racing|tight chest)\b", 4),
            (r"\b(nervous|anxious)\b", 2),
        ],
    },
    "default": {
        "patterns": [],
    }
}

CONFIDENCE_THRESHOLD = 3

# ---------- Questions for AI to ask ----------
QUESTION_BANK = {
    "audience_followup": [
        "Can you tell us more about that part?",
        "What happened right after that?",
        "What was going through your mind in that moment?",
        "How did you feel when that happened?"
    ],
    "evaluation_fear": [
        "When you say you felt judged, what did you think people were thinking?",
        "What reaction from others were you most worried about?",
        "What felt most awkward in that moment?"
    ],
    "avoidance": [
        "What made you decide not to tell anyone at first?",
        "Was there a moment you wanted to speak up but didn’t?",
        "What felt too risky about sharing it back then?"
    ],
    "somatic": [
        "Did your body react in any way when you were stressed?",
        "What did you notice physically when you were anxious?",
        "Was there a point where it felt like your nerves peaked?"
    ],
    "encouraging_reflection": [
        "What do you think helped you get through it?",
        "Looking back, what are you proud of?",
        "What would you want others to understand about that experience?"
    ],
    "hesitation": [
        "Take your time. Which part is hardest to talk about?",
        "If you’re not sure where to start, what’s the first thing that comes to mind?",
        "What detail feels most important to mention?"
    ]
}

FILLERS = ["um", "uh", "like", "you know", "kind of", "sort of", "i mean"]

class AnalyzeRequest(BaseModel):
    session_id: str | None = None
    time_sec: float = 0.0
    utterance: str
    gap_sec: float | None = None #gap between what was last said and what is being said
    recent_context: str | None = None

class AnalyzeResponse(BaseModel):
    category: str
    score: int
    question: str
    time_sec: float

def score_category(text: str, patterns: list[tuple[str,int]]) -> int:
    score = 0
    for pattern, weight in patterns:
        if re.search(pattern, text, flags=re.IGNORECASE):
            score += weight
    return score

def filler_count(text: str) -> int:
    t = text.lower()
    return sum(t.count(f) for f in FILLERS)

def detect_category(text: str) -> tuple[str, int]:
    # safety first
    safety_score = score_category(text, TRIGGERS["safety"]["patterns"])
    if safety_score >= CONFIDENCE_THRESHOLD:
        return "safety", safety_score

    best_cat = "default"
    best_score = 0
    for cat in ["evaluation_fear", "avoidance", "somatic"]:
        s = score_category(text, TRIGGERS[cat]["patterns"])
        if s > best_score:
            best_cat, best_score = cat, s

    if best_score < CONFIDENCE_THRESHOLD:
        return "default", best_score
    return best_cat, best_score

@app.get("/health")
def health():
    return {"ok": True, "ts": time.time()}

@app.post("/analyze", response_model=AnalyzeResponse)
def analyze(req: AnalyzeRequest):
    utter = (req.utterance or "").strip()

    # Hesitation heuristic (voice-ish cues via transcript + pause gap)
    gap = req.gap_sec or 0.0
    fills = filler_count(utter)
    very_short = len(utter.split()) <= 3

    # Topic detection (simple + explainable)
    cat, score = detect_category(utter)  # keep your existing detect_category

    # Choose what kind of audience question to ask
    if gap >= 2.5 or fills >= 2 or very_short:
        category = "hesitation"
        question = random.choice(QUESTION_BANK["hesitation"])
        score_out = 0
    else:
        # Map detected category to audience-style pools
        if cat == "evaluation_fear":
            category = "evaluation_fear"
            question = random.choice(QUESTION_BANK["evaluation_fear"])
            score_out = score
        elif cat == "avoidance":
            category = "avoidance"
            question = random.choice(QUESTION_BANK["avoidance"])
            score_out = score
        elif cat == "somatic":
            category = "somatic"
            question = random.choice(QUESTION_BANK["somatic"])
            score_out = score
        else:
            # Story-context friendly defaults
            # If they’ve reached a “growth” part, ask reflection
            lower_ctx = (req.recent_context or "").lower()
            if any(w in lower_ctx for w in ["help", "support", "learned", "improved", "recovered", "managed"]):
                category = "encouraging_reflection"
                question = random.choice(QUESTION_BANK["encouraging_reflection"])
            else:
                category = "audience_followup"
                question = random.choice(QUESTION_BANK["audience_followup"])
            score_out = score

    return AnalyzeResponse(
        category=category,
        score=score_out,
        question=question,
        time_sec=req.time_sec
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)