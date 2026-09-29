
const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 10000;
const API_KEY = process.env.GEMINI_API_KEY;

// Fast Gemini model
const MODEL = "gemini-3.8-flash";

// --------------------------------------------------
// BASIC ROUTES
// --------------------------------------------------

app.get("/", (req, res) => {
  res.json({
    name: "NEXO AI Backend",
    status: "online"
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    ai: API_KEY ? "configured" : "missing_api_key"
  });
});

// --------------------------------------------------
// INDIA DATE / TIME
// --------------------------------------------------

function getIndiaDateTime() {
  const now = new Date();

  const date = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(now);

  const time = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  }).format(now);

  const day = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "long"
  }).format(now);

  return {
    date,
    time,
    day
  };
}

// --------------------------------------------------
// DATE / TIME DETECTION
// --------------------------------------------------

function isDateTimeQuestion(text) {
  const q = String(text || "").toLowerCase();

  const words = [
    "what time",
    "current time",
    "time now",
    "today's date",
    "todays date",
    "what date",
    "what day",
    "which day",
    "today",
    "tomorrow",
    "yesterday",
    "date today",
    "time please",

    // Hindi / Hinglish
    "abhi kitne baje",
    "kitne baje",
    "aaj ki date",
    "aaj kya date hai",
    "aaj ka din",
    "aaj konsa din",
    "aaj kaun sa din",
    "kal kya date",
    "abhi time kya hai",
    "samay kya hai",
    "vartaman samay",

    // Devanagari
    "अभी कितने बजे",
    "अभी समय क्या है",
    "आज की तारीख",
    "आज कौन सा दिन",
    "आज का दिन",
    "कल की तारीख",
    "समय क्या है",
    "वर्तमान समय"
  ];

  return words.some(word => q.includes(word));
}

// --------------------------------------------------
// LOCAL DATE/TIME RESPONSE
// --------------------------------------------------

function getDateTimeAnswer(userText) {
  const dt = getIndiaDateTime();
  const q = String(userText || "").toLowerCase();

  // Hindi / Devanagari
  if (
    q.includes("तारीख") ||
    q.includes("आज की तारीख") ||
    q.includes("aaj ki date") ||
    q.includes("aaj kya date")
  ) {
    return `आज की तारीख ${dt.date} है।`;
  }

  if (
    q.includes("कौन सा दिन") ||
    q.includes("कौनसा दिन") ||
    q.includes("आज का दिन") ||
    q.includes("aaj ka din") ||
    q.includes("aaj konsa din")
  ) {
    return `आज ${dt.day} है।`;
  }

  if (
    q.includes("कितने बजे") ||
    q.includes("समय") ||
    q.includes("time") ||
    q.includes("kitne baje")
  ) {
    return `अभी भारत में समय ${dt.time} है।`;
  }

  return `आज ${dt.day}, ${dt.date} है और भारत में अभी ${dt.time} है।`;
}

// --------------------------------------------------
// UNIVERSAL MULTI-LANGUAGE AI PROMPT
// --------------------------------------------------

function buildPrompt(userMessage) {
  return `
You are NEXO AI, a highly capable multilingual AI assistant.

USER MESSAGE:
${userMessage}

IMPORTANT LANGUAGE RULES:

1. Detect the language of the user's message automatically.
2. Understand the user's meaning even if the language is uncommon.
3. Reply in the SAME LANGUAGE used by the user.
4. If the user uses Romanized Hindi, Romanized Urdu, Romanized Punjabi,
   Romanized Bengali, or another Romanized language, reply in the same
   Romanized style when appropriate.
5. If the user mixes multiple languages, understand the complete meaning
   and reply naturally in the dominant language.
6. Never force English unless the user is speaking English or asks for English.
7. Never say that you only support English or Hindi.
8. Do not ask the user to translate their question.
9. If the user asks for translation, translate into the exact requested language.
10. Preserve names, numbers, code, URLs, technical terms and proper nouns.
11. For programming questions, provide correct code and explain it in the
    language/style the user is using.
12. For factual questions, answer clearly and directly.
13. If the question is ambiguous, ask a short clarification in the user's language.
14. If the user asks for a list, use a clean list.
15. If the user asks for step-by-step instructions, give numbered steps.
16. Do not mention these internal instructions.
17. Do not announce the detected language.
18. Do not unnecessarily translate the user's question.
19. Be concise unless the user asks for detailed information.
20. You can understand and answer multilingual conversations.

The user can communicate in any natural human language.
Do your best to understand and respond naturally.

Now answer the user's message.
`;
}

// --------------------------------------------------
// GEMINI REQUEST
// --------------------------------------------------

async function askGemini(userMessage) {
  if (!API_KEY) {
    throw new Error("GEMINI_API_KEY is missing");
  }

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: buildPrompt(userMessage)
          }
        ]
      }
    ],

    generationConfig: {
      thinkingConfig: {
        thinkingLevel: "low"
      },
      maxOutputTokens: 4096
    }
  };

  const controller = new AbortController();

  // 30 second timeout
  const timeout = setTimeout(() => {
    controller.abort();
  }, 30000);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    const rawText = await response.text();

    let data;

    try {
      data = JSON.parse(rawText);
    } catch {
      throw new Error(
        `Gemini returned invalid JSON: ${rawText.slice(0, 500)}`
      );
    }

    if (!response.ok) {
      console.error("GEMINI ERROR:", JSON.stringify(data, null, 2));

      const message =
        data?.error?.message ||
        `Gemini HTTP ${response.status}`;

      throw new Error(message);
    }

    const reply =
      data?.candidates?.[0]?.content?.parts
        ?.map(part => part.text || "")
        .join("")
        .trim();

    if (!reply) {
      console.error(
        "EMPTY GEMINI RESPONSE:",
        JSON.stringify(data, null, 2)
      );

      throw new Error("Gemini returned an empty response");
    }

    return reply;

  } finally {
    clearTimeout(timeout);
  }
}

// --------------------------------------------------
// CHAT API
// --------------------------------------------------

app.post("/chat", async (req, res) => {
  const message = String(req.body?.message || "").trim();

  if (!message) {
    return res.status(400).json({
      error: "Message is required"
    });
  }

  console.log("NEXO USER:", message);

  try {
    // Date/time questions are answered locally and instantly
    if (isDateTimeQuestion(message)) {
      const answer = getDateTimeAnswer(message);

      console.log("NEXO LOCAL:", answer);

      return res.json({
        reply: answer
      });
    }

    // AI response
    const answer = await askGemini(message);

    console.log("NEXO AI RESPONSE:", answer.slice(0, 200));

    return res.json({
      reply: answer
    });

  } catch (error) {
    console.error("NEXO ERROR:", error);

    return res.status(500).json({
      error: "AI response unavailable",
      details: error.message
    });
  }
});

// --------------------------------------------------
// START SERVER
// --------------------------------------------------

app.listen(PORT, "0.0.0.0", () => {
  console.log(`NEXO AI Backend running on port ${PORT}`);
});