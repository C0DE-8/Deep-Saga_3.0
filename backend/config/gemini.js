// backend/config/gemini.js
const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// Swapping to the newer, less congested workhorse model
const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite-preview" });

module.exports = { model, genAI };
