import express from "express";
import { OpenAI } from "openai";
import jwt from "jsonwebtoken";
import { User } from "../models/User.js";

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || "d5f721491a7b51a3c83511efd6457e87729f100ee8f2c3191e4f4384c45f373a2f880ac2fef1fb574d43a4f80e9f4181010b925059da21a0a994e895c01ba0eb";

const OPENAI_KEY = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || null;
if (!OPENAI_KEY) {
  console.error("Warning: OPENAI_API_KEY not set — /api/openai/coach will fail without it.");
}

const client = new OpenAI({ apiKey: OPENAI_KEY });

// Token verification middleware
const verifyToken = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header) {
    return res.status(401).json({ error: "No token provided" });
  }

  try {
    const token = header.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    req.userId = decoded.id;
    const user = await User.findById(decoded.id);

    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    req.user = user;
    next();
  } catch (err) {
    console.error("[Coach Auth Error]", err.message);
    return res.status(401).json({ error: "Invalid token" });
  }
};

const buildSystemPrompt = (context) => {
  const t = context?.todaysTotals || {};
  const tg = context?.targets || {};
  const wp = context?.weightProgress || {};
  
  return `You are a professional nutrition coach.

Your job is to help users achieve their goals safely.

CURRENT USER DATA:
- Today's Calories: ${t.calories || 0} kcal (Target: ${tg.calories || 2000})
- Today's Protein: ${t.protein || 0}g (Target: ${tg.protein || 150}g)
- Today's Carbs: ${t.carbs || 0}g (Target: ${tg.carbs || 250}g)
- Today's Fat: ${t.fat || 0}g (Target: ${tg.fat || 70}g)
- Current Weight: ${wp.currentWeight || 0} kg
- Goal Weight: ${wp.goalWeight || 0} kg
- Streak: ${context?.streakDays || 0} days

GUIDELINES:
- Always give practical and realistic advice
- Never shame users
- If user exceeds calories: suggest adjustments for remaining meals
- If user is below protein target: suggest high protein foods
- Keep answers concise and actionable (max 2-3 sentences)
- Be encouraging and supportive`;
};

router.post("/coach", verifyToken, async (req, res) => {
  try {
    const { message, context } = req.body || {};
    if (!message) return res.status(400).json({ error: "Missing message" });

    const system = buildSystemPrompt(context);

    // Build a context summary
    const ctxLines = [];
    if (context?.recentMeals) {
      const rm = context.recentMeals;
      ctxLines.push(`Recent meals — Breakfast: ${rm.breakfast || "-"}; Lunch: ${rm.lunch || "-"}; Dinner: ${rm.dinner || "-"}; Snacks: ${(rm.snacks || []).join(", ") || "-"}`);
    }

    const contextText = ctxLines.length > 0 ? `Context:\n${ctxLines.join("\n")}` : "";

    const messages = [
      { role: "system", content: system },
    ];
    
    if (contextText) {
      messages.push({ role: "system", content: contextText });
    }
    
    messages.push({ role: "user", content: message });

    // Use Chat Completions API
    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages,
      temperature: 0.7,
      max_tokens: 300,
    });

    const out = completion.choices && completion.choices[0] && completion.choices[0].message;
    const content = out?.content || "";

    console.log(`[Coach] Request from ${req.user?.email || "unknown"}: ${message.substring(0, 50)}...`);

    return res.json({ id: `coach-${Date.now()}`, role: "assistant", content, createdAt: new Date().toISOString() });
  } catch (err) {
    console.error("/api/openai/coach error:", err);
    res.status(500).json({ error: String(err) });
  }
});

export { router as openaiRoute };
