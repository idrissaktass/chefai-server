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
  const t  = context?.todaysTotals || {};
  const tg = context?.targets || {};
  const wp = context?.weightProgress || {};
  const streak = context?.streakDays || 0;
  const lang = context?.language === "tr" ? "Turkish" : "English";

  const calPct  = tg.calories ? Math.round((t.calories  / tg.calories)  * 100) : 0;
  const protPct = tg.protein  ? Math.round((t.protein   / tg.protein)   * 100) : 0;

  let weightNote = "";
  if (wp.currentWeight && wp.goalWeight) {
    const diff = wp.goalWeight - wp.currentWeight;
    weightNote = diff > 0
      ? `needs to gain ${Math.abs(diff).toFixed(1)} kg`
      : diff < 0
      ? `needs to lose ${Math.abs(diff).toFixed(1)} kg`
      : "at goal weight";
  }

  return `You are a warm, knowledgeable nutrition coach having an ongoing chat with your client. Reply in with client prompt language.

CLIENT DATA:
- Calories today: ${t.calories || 0} / ${tg.calories || 2000} kcal (${calPct}%)
- Protein: ${t.protein || 0} / ${tg.protein || 150}g (${protPct}%)
- Carbs: ${t.carbs || 0}g, Fat: ${t.fat || 0}g
- Weight: ${wp.currentWeight || 0} kg → goal ${wp.goalWeight || 0} kg${weightNote ? ` (${weightNote})` : ""}
- Logging streak: ${streak} days

RULES:
- This is a continuous conversation — remember and build on what was said earlier. Answer follow-up questions naturally.
- Keep it concise (2-4 sentences). Go a little longer only when the client asks for a plan, list, or explanation.
- Use the client's real numbers above; give specific, actionable advice — never vague filler.
- Warm, direct tone, like a text from a nutritionist friend. Up to 1 emoji. No headers.`;
};

router.post("/coach", verifyToken, async (req, res) => {
  try {
    const { message, context, history } = req.body || {};
    if (!message) return res.status(400).json({ error: "Missing message" });

    const system = buildSystemPrompt(context);

    // Build a detailed context summary from meals
    const ctxLines = [];
    if (context?.recentMeals) {
      const rm = context.recentMeals;
      const meals = [];
      if (rm.breakfast) meals.push(`Breakfast: ${rm.breakfast}`);
      if (rm.lunch) meals.push(`Lunch: ${rm.lunch}`);
      if (rm.dinner) meals.push(`Dinner: ${rm.dinner}`);
      if (rm.snacks && rm.snacks.length > 0) meals.push(`Snacks: ${rm.snacks.join(", ")}`);
      
      if (meals.length > 0) {
        ctxLines.push(`Today's Meals Logged:\n${meals.join("\n")}`);
      }
    }

    const contextText = ctxLines.length > 0 ? `Context:\n${ctxLines.join("\n")}` : "";

    const messages = [
      { role: "system", content: system },
    ];
    
    if (contextText) {
      messages.push({ role: "system", content: contextText });
    }

    // Prior turns so the coach can hold a real conversation (cap to last 10).
    if (Array.isArray(history)) {
      history
        .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
        .slice(-10)
        .forEach((m) => messages.push({ role: m.role, content: m.content }));
    }

    messages.push({ role: "user", content: message });

    // Use Chat Completions API with optimized settings for concise responses
    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages,
      temperature: 0.75,
      max_tokens: 400,
    });

    const out = completion.choices && completion.choices[0] && completion.choices[0].message;
    const content = out?.content || "";

    console.log(`[Coach] ${req.user?.email || "unknown"}: "${message.substring(0, 50)}..." → Response sent`);

    return res.json({ 
      id: `coach-${Date.now()}`, 
      role: "assistant", 
      content, 
      createdAt: new Date().toISOString() 
    });
  } catch (err) {
    console.error("/api/openai/coach error:", err);
    res.status(500).json({ error: String(err) });
  }
});

export { router as openaiRoute };
