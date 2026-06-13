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

// ── Abuse / cost protection ──────────────────────────────────────────────────
const COACH_DAILY_LIMIT_PREMIUM = Number(process.env.COACH_DAILY_LIMIT_PREMIUM) || 50;
const COACH_DAILY_LIMIT_FREE    = Number(process.env.COACH_DAILY_LIMIT_FREE)    || 5;
const COACH_BURST_MAX           = Number(process.env.COACH_BURST_MAX)           || 10; // per window
const COACH_BURST_WINDOW_MS     = 60_000; // 1 minute
const COACH_MAX_MESSAGE_LEN     = 1000;

// In-memory burst tracker: userId -> recent request timestamps.
// Note: per-process only. Fine for a single Render instance; switch to Redis if you scale out.
const burstHits = new Map();

const todayKey = () => new Date().toISOString().split("T")[0];

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

const LANG_NAMES = { en: "English", tr: "Turkish", de: "German", fr: "French", es: "Spanish" };

const PERSONAS = {
  warm: {
    intro: "You are a warm, deeply caring nutrition coach. You celebrate every small win, offer genuine encouragement, and make your client feel supported and capable no matter where they are in their journey.",
    tone: "Uplifting and personal — like a best friend who happens to be a dietitian. Use the client's real numbers to give specific praise or gentle nudges. Up to 1 emoji. No headers.",
  },
  funny: {
    intro: "You are a comedy-obsessed nutrition coach who treats every message like a stand-up set. You CANNOT stop making food puns, pop-culture references, and absurd comparisons. You are genuinely, effortfully hilarious — not just 'a little playful'. Think: if a dietitian and a comedian had a baby.",
    tone: "Every response must have at least one real joke, pun, or funny twist — delivered BEFORE or ALONGSIDE the advice, not as an afterthought. Advice must still be nutritionally accurate. Up to 2 emojis. No headers. Never explain the joke.",
  },
  strict: {
    intro: "You are a relentlessly strict, military-grade nutrition coach. No excuses, no participation trophies, no sugarcoating. You speak in short, commanding sentences. Missed protein target? Unacceptable. Skipped a meal? Explain yourself. You treat nutrition like military discipline and expect results.",
    tone: "Blunt, commanding, zero fluff. Channel a drill sergeant who studied dietetics. Short punchy sentences. Call out every shortfall directly. Zero tolerance for vague or soft language. 1 emoji max. No headers.",
  },
  grumpy: {
    intro: "You are a chronically grumpy nutrition coach who is always tired, perpetually unimpressed, and mildly annoyed by everything — including this conversation. You use heavy sarcasm and dry wit. You give accurate advice while making it crystal clear you've seen it all before and nothing surprises you anymore.",
    tone: "Drip every sentence with sarcasm and exasperation. Phrases like 'Oh wow, groundbreaking', 'Shocking, truly shocking', 'What a surprise — nobody could have predicted this', 'Congratulations, you've discovered food'. Still give real, useful, accurate advice — just with maximum eye-roll energy. 1 emoji. No headers.",
  },
};

const buildSystemPrompt = (context) => {
  const t  = context?.todaysTotals || {};
  const tg = context?.targets || {};
  const wp = context?.weightProgress || {};
  const streak = context?.streakDays || 0;
  const lang = LANG_NAMES[context?.language] || "English";
  const persona = PERSONAS[context?.personality] || PERSONAS.warm;

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

  return `${persona.intro} Always respond in ${lang}. If the client writes in a different language, switch and respond in that language instead.

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
- ${persona.tone}`;
};

router.post("/coach", verifyToken, async (req, res) => {
  try {
    const { message, context, history, skipLimit } = req.body || {};
    if (!message) return res.status(400).json({ error: "Missing message" });

    // Server-side length guard (frontend caps at 500, this is a hard ceiling).
    if (typeof message !== "string" || message.length > COACH_MAX_MESSAGE_LEN) {
      return res.status(400).json({ error: "Message too long" });
    }

    const user = req.user;
    const uid = String(req.userId);

    // 1) Burst protection — block rapid-fire spamming.
    const now = Date.now();
    const hits = (burstHits.get(uid) || []).filter((ts) => now - ts < COACH_BURST_WINDOW_MS);
    if (hits.length >= COACH_BURST_MAX) {
      return res.status(429).json({
        errorCode: "COACH_RATE_LIMITED",
        error: "Too many messages, please slow down.",
      });
    }
    hits.push(now);
    burstHits.set(uid, hits);

    // 2) Daily quota — premium vs free (skipLimit = automatic insights, not counted).
    const limit = user.isPremium ? COACH_DAILY_LIMIT_PREMIUM : COACH_DAILY_LIMIT_FREE;
    const today = todayKey();

    // Always reset on a new day, regardless of whether this is an insight or user message.
    if (user.coachDailyDate !== today) {
      user.coachDailyDate = today;
      user.coachDailyCount = 0;
    }

    if (!skipLimit) {
      if (user.coachDailyCount >= limit) {
        return res.status(402).json({
          errorCode: "COACH_DAILY_LIMIT_REACHED",
          isPremium: !!user.isPremium,
          limit,
          error: user.isPremium ? "Daily message limit reached." : "Free daily limit reached.",
        });
      }
    }

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

    // Count this turn against the daily quota (insights skip it).
    if (!skipLimit) {
      user.coachDailyCount += 1;
      await user.save();
    }

    console.log(`[Coach] ${req.user?.email || "unknown"} (${user.coachDailyCount}/${limit}): "${message.substring(0, 50)}..." → Response sent`);

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
