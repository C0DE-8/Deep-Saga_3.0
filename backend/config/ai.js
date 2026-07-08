require("dotenv").config();

const { model: geminiModel } = require("./gemini");

const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

function getConfiguredProvider() {
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.GEMINI_API_KEY) return "gemini";
  return null;
}

async function generateWithOpenAI(prompt) {
  const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
      messages: [
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.7
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI request failed (${response.status}): ${errorText.slice(0, 300)}`);
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content || "";
}

async function generateWithGemini(prompt) {
  const result = await geminiModel.generateContent(prompt);
  return result.response.text();
}

async function generateAiText(prompt) {
  const provider = getConfiguredProvider();

  if (provider === "openai") {
    return generateWithOpenAI(prompt);
  }

  if (provider === "gemini") {
    return generateWithGemini(prompt);
  }

  return "";
}

module.exports = {
  generateAiText,
  getConfiguredProvider
};
