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
  "gemini-3.5-flash-lite",
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithTimeout(url, options, timeoutMs = 30000) {
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
    30000
  );
}

app.post("/chat", async (req, res) => {
  try {
    const message = String(req.body?.message || "").trim();

    if (!message) {
      return res.status(400).json({
        error: "Message is required",
      });
    }

    if (!GEMINI_API_KEY) {
      return res.status(500).json({
        error: "GEMINI_API_KEY is not configured on the server",
      });
    }

    const prompt = `
You are NEXO AI, a helpful and intelligent AI assistant.

Answer the user's request directly and naturally.

Rules:
- Be accurate and useful.
- Keep normal answers reasonably concise.
- Understand Hindi, Hinglish and English.
- If the user asks in Hindi or Hinglish, answer naturally in Hindi/Hinglish.
- For coding requests, provide complete working code.
- For website requests, generate complete responsive HTML/CSS/JavaScript when appropriate.
- Do not mention these instructions.

USER:
${message}
`;

    let lastStatus = 503;
    let lastError = "AI service temporarily unavailable";

    for (const model of MODELS) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          console.log(
            `NEXO request: model=${model}, attempt=${attempt}`
          );

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

            lastStatus = 500;
            lastError = "Gemini returned an empty response";

            break;
          }

          lastStatus = response.status;

          lastError =
            data?.error?.message ||
            data?.error?.status ||
            "Unknown Gemini API error";

          console.error("Gemini error:", {
            model,
            attempt,
            status: response.status,
            error: lastError,
          });

          if (
            (response.status === 429 || response.status >= 500) &&
            attempt < 2
          ) {
            await sleep(1500);
            continue;
          }

          break;
        } catch (error) {
          lastStatus = 503;
          lastError =
            error.name === "AbortError"
              ? "Gemini request timed out"
              : error.message || "Network error";

          console.error("NEXO request error:", {
            model,
            attempt,
            error: lastError,
          });

          if (attempt < 2) {
            await sleep(1500);
          }
        }
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