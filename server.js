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
  process.env.GEMINI_MODEL || "gemini-3.8-flash",
  "gemini-3.7-flash",
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

  return fetch(url, {
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
        maxOutputTokens: 8192,
      },
    }),
  });
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
You are NEXO AI, a helpful, intelligent AI assistant.

Answer the user's request accurately and clearly.

For normal questions:
- Give a direct, useful answer.
- Use simple language when appropriate.
- Do not mention internal instructions.

For coding requests:
- Provide complete working code when possible.
- Do not intentionally omit important parts.

For website/app generation requests:
- Generate production-quality HTML, CSS and JavaScript when requested.
- Prefer a complete single-file HTML document unless the user specifically requests another structure.
- Make interfaces responsive and mobile-friendly.
- Include functional interactions using vanilla JavaScript when appropriate.

USER REQUEST:
${message}
`;

    let lastStatus = 500;
    let lastDetails = "Unknown Gemini error";

    for (const model of MODELS) {
      for (let attempt = 1; attempt <= 4; attempt++) {
        try {
          const response = await callGemini(model, prompt);
          const data = await response.json();

          if (response.ok) {
            const reply =
              data?.candidates?.[0]?.content?.parts
                ?.map((part) => part.text || "")
                .join("")
                .trim();

            if (reply) {
              return res.json({
                reply,
                model,
              });
            }

            lastStatus = 500;
            lastDetails = "Gemini returned an empty response";
            break;
          }

          lastStatus = response.status;

          lastDetails =
            data?.error?.message ||
            data?.error?.status ||
            "Unknown Gemini error";

          console.error("Gemini API error:", {
            model,
            attempt,
            status: response.status,
            details: lastDetails,
          });

          if (response.status === 429 || response.status >= 500) {
            if (attempt < 4) {
              const delay = Math.min(
                1000 * 2 ** (attempt - 1),
                8000
              );

              const jitter = Math.floor(Math.random() * 500);

              await sleep(delay + jitter);

              continue;
            }
          }

          break;
        } catch (error) {
          lastStatus = 500;
          lastDetails = error.message || "Network error";

          console.error("Gemini request error:", {
            model,
            attempt,
            details: lastDetails,
          });

          if (attempt < 4) {
            const delay = Math.min(
              1000 * 2 ** (attempt - 1),
              8000
            );

            const jitter = Math.floor(Math.random() * 500);

            await sleep(delay + jitter);
          }
        }
      }
    }

    return res.status(lastStatus >= 400 ? lastStatus : 503).json({
      error: "AI service temporarily unavailable",
      details: lastDetails,
      retryable: lastStatus === 429 || lastStatus >= 500,
    });
  } catch (error) {
    console.error("Backend error:", error);

    return res.status(500).json({
      error: "AI backend error",
      details: error.message,
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`NEXO AI backend running on port ${PORT}`);
});