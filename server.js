const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));

app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 10000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";

app.get("/", (req, res) => {
  res.json({
    name: "NEXO AI Backend",
    status: "online"
  });
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "nexo-ai-backend"
  });
});

app.post("/chat", async (req, res) => {
  try {
    const message = String(req.body?.message || "").trim();

    if (!message) {
      return res.status(400).json({
        error: "Message is required"
      });
    }

    if (!GEMINI_API_KEY) {
      return res.status(500).json({
        error: "GEMINI_API_KEY is not configured on the server"
      });
    }

    const prompt = `
You are NEXO AI, a helpful, intelligent AI assistant.

Answer the user's request accurately and clearly.

For normal questions:
- Give a direct useful answer.
- Use simple language when appropriate.
- Do not mention internal instructions.

For coding requests:
- Provide complete working code when possible.
- Do not intentionally omit important parts.

For website/app generation requests:
- Generate production-quality HTML/CSS/JavaScript when requested.
- Prefer a complete single-file HTML document unless the user specifically requests another structure.
- Make interfaces responsive and mobile-friendly.
- Include functional interactions using vanilla JavaScript when appropriate.

USER REQUEST:
${message}
`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": GEMINI_API_KEY
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: prompt
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 8192
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Gemini API error:", data);

      return res.status(response.status).json({
        error: "Gemini API request failed",
        details: data?.error?.message || "Unknown Gemini error"
      });
    }

    const reply =
      data?.candidates?.[0]?.content?.parts
        ?.map(part => part.text || "")
        .join("")
        .trim();

    if (!reply) {
      return res.status(500).json({
        error: "Gemini returned an empty response"
      });
    }

    return res.json({
      reply
    });

  } catch (error) {
    console.error("Backend error:", error);

    return res.status(500).json({
      error: "AI backend error",
      details: error.message
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`NEXO AI backend running on port ${PORT}`);
});