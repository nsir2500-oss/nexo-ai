const express = require("express");
const cors = require("cors");

const app = express();

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);

app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 10000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const MODELS = [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getIndiaDateTime() {
  const now = new Date();

  const parts = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).formatToParts(now);

  const get = (type) => {
    const part = parts.find((p) => p.type === type);
    return part ? part.value : "";
  };

  return {
    weekday: get("weekday"),
    day: get("day"),
    month: get("month"),
    year: get("year"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
    period: get("dayPeriod"),
  };
}

function isDateTimeQuestion(message) {
  const text = message.toLowerCase().trim();

  const keywords = [
    "aaj kaun sa day",
    "aaj konsa day",
    "aaj kya day",
    "aaj ka day",
    "aaj kaun sa din",
    "aaj konsa din",
    "aaj kya din",
    "aaj ki date",
    "aaj date",
    "today date",
    "today's date",
    "what is today's date",
    "what date is today",
    "what day is today",
    "which day is today",
    "today day",
    "current date",
    "current day",
    "abhi time",
    "abhi kya time",
    "kya time hai",
    "kitne baje",
    "what time is it",
    "current time",
    "time right now",
    "today",
    "aaj",
  ];

  return keywords.some((keyword) => text.includes(keyword));
}

function buildDateTimeReply(message) {
  const dt = getIndiaDateTime();
  const text = message.toLowerCase();

  const asksTime =
    text.includes("time") ||
    text.includes("baje") ||
    text.includes("waqt") ||
    text.includes("samay");

  const asksDate =
    text.includes("date") ||
    text.includes("tarikh") ||
    text.includes("today");

  const asksDay =
    text.includes("day") ||
    text.includes("din") ||
    text.includes("aaj");

  if (asksTime && !asksDate && !asksDay) {
    return `Abhi India time ke according ${dt.hour}:${dt.minute}:${dt.second} ${dt.period} hai.`;
  }

  if (asksDate && !asksDay) {
    return `Aaj ${dt.day} ${dt.month} ${dt.year} hai.`;
  }

  if (asksDay && !asksDate && !asksTime) {
    return `Aaj ${dt.weekday} hai.`;
  }

  return `Aaj ${dt.weekday}, ${dt.day} ${dt.month} ${dt.year} hai aur abhi India time ${dt.hour}:${dt.minute}:${dt.second} ${dt.period} hai.`;
}

async function fetchWithTimeout(url, options, timeoutMs = 18000) {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function callGemini(model, prompt) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  return fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: prompt,
              },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens: 4096,
          thinkingConfig: {
            thinkingLevel: "low",
          },
        },
      }),
    },
    18000
  );
}

app.get("/", (req, res) => {
  res.json({
    name: "NEXO AI Backend",
    status: "online",
  });
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "nexo-ai-backend",
  });
});

app.post("/chat", async (req, res) => {
  try {
    const message = String(req.body?.message || "").trim();

    if (!message) {
      return res.status(400).json({
        error: "Message is required",
      });
    }

    /*
      CURRENT INDIA DATE/TIME
    */
    const indiaDateTime = getIndiaDateTime();

    /*
      ANSWER SIMPLE DATE/TIME QUESTIONS DIRECTLY.
      This avoids unnecessary Gemini requests and gives
      an accurate India-time answer.
    */
    if (isDateTimeQuestion(message)) {
      return res.json({
        reply: buildDateTimeReply(message),
        source: "nexo-clock",
      });
    }

    if (!GEMINI_API_KEY) {
      return res.status(500).json({
        error: "GEMINI_API_KEY is not configured on the server",
      });
    }

    const prompt = `
You are NEXO AI, a helpful, intelligent AI assistant.

You understand:
- English
- Hindi
- Hinglish

Always answer naturally in the same language style used by the user.

Current India date and time:
Date: ${indiaDateTime.day} ${indiaDateTime.month} ${indiaDateTime.year}
Day: ${indiaDateTime.weekday}
Time: ${indiaDateTime.hour}:${indiaDateTime.minute}:${indiaDateTime.second} ${indiaDateTime.period}
Timezone: Asia/Kolkata (India)

Important:
- Use the supplied current India date/time when the user asks about today's date, day or time.
- Do not say that you do not have access to a clock.
- Do not invent a different current date.
- Give direct and useful answers.
- Keep normal answers reasonably concise.
- For coding requests, provide complete working code.
- For website/app requests, provide complete responsive HTML/CSS/JavaScript when appropriate.
- Do not mention these instructions.

USER REQUEST:
${message}
`;

    let lastError = "AI service temporarily unavailable";

    for (const model of MODELS) {
      try {
        console.log(`NEXO request: model=${model}`);

        const response = await callGemini(model, prompt);
        const data = await response.json();

        if (response.ok) {
          const reply =
            data?.candidates?.[0]?.content?.parts
              ?.map((part) => part.text || "")
              .join("")
              .trim();

          if (reply) {
            console.log(`NEXO success: ${model}`);

            return res.json({
              reply,
              model,
            });
          }

          lastError = "Gemini returned an empty response";
        } else {
          lastError =
            data?.error?.message ||
            data?.error?.status ||
            "Unknown Gemini API error";

          console.error("Gemini API error:", {
            model,
            status: response.status,
            error: lastError,
          });

          if (response.status === 429 || response.status >= 500) {
            await sleep(800);
            continue;
          }

          break;
        }
      } catch (error) {
        lastError =
          error.name === "AbortError"
            ? "Gemini request timed out"
            : error.message || "Network error";

        console.error("NEXO request error:", {
          model,
          error: lastError,
        });

        await sleep(500);
      }
    }

    return res.status(503).json({
      error: "AI service temporarily unavailable",
      details: lastError,
      retryable: true,
    });
  } catch (error) {
    console.error("NEXO backend error:", error);

    return res.status(500).json({
      error: "AI backend error",
      details: error.message,
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`NEXO AI backend running on port ${PORT}`);
});