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
  const streak = context?.streakDays || 0;
  
  // Calculate macro percentages
  const calorieProgress = t.calories ? Math.round((t.calories / tg.calories) * 100) : 0;
  const proteinProgress = t.protein ? Math.round((t.protein / tg.protein) * 100) : 0;
  const carbsProgress = t.carbs ? Math.round((t.carbs / tg.carbs) * 100) : 0;
  const fatProgress = t.fat ? Math.round((t.fat / tg.fat) * 100) : 0;
  
  // Weight loss/gain calculation
  let weightStatus = "";
  if (wp.currentWeight && wp.goalWeight) {
    const weightDiff = wp.goalWeight - wp.currentWeight;
    if (weightDiff > 0) {
      weightStatus = `Need to gain ${Math.abs(weightDiff).toFixed(1)} kg`;
    } else if (weightDiff < 0) {
      weightStatus = `Need to lose ${Math.abs(weightDiff).toFixed(1)} kg`;
    } else {
      weightStatus = "At goal weight! 🎉";
    }
  }

  return `You are a professional, empathetic registered dietitian and nutrition coach. You are skilled at helping clients achieve their health and fitness goals through sustainable nutrition habits.

YOUR ROLE:
- Provide personalized, evidence-based nutrition advice
- Be supportive and encouraging (never shame or judge)
- Ask clarifying questions when needed
- Give specific, actionable meal suggestions
- Celebrate progress and consistency
- Focus on sustainable lifestyle changes

CURRENT CLIENT DATA:
Daily Nutrition Status:
- Calories: ${t.calories || 0}/${tg.calories || 2000} kcal (${calorieProgress}% complete)
- Protein: ${t.protein || 0}/${tg.protein || 150}g (${proteinProgress}% complete) 
- Carbs: ${t.carbs || 0}/${tg.carbs || 250}g (${carbsProgress}% complete)
- Fat: ${t.fat || 0}/${tg.fat || 70}g (${fatProgress}% complete)

Weight Progress:
- Current: ${wp.currentWeight || 0} kg
- Goal: ${wp.goalWeight || 0} kg
- Status: ${weightStatus}
- Consistency Streak: 🔥 ${streak} days!

RESPONSE GUIDELINES:
1. Keep responses concise but warm (2-3 sentences max for general advice)
2. Reference their actual data when giving suggestions
3. If calories exceeded (>110%): Suggest lighter options for remaining meals and explain strategies
4. If protein insufficient (<80% target): Recommend specific high-protein foods
5. If on track (80-110%): Celebrate and provide encouragement
6. Suggest water intake and movement when appropriate
7. Use encouraging language that feels like talking to a real nutritionist
8. End with an actionable tip or motivation

TONE: Professional yet warm, knowledgeable yet approachable, data-driven yet human.`;
};

router.post("/coach", verifyToken, async (req, res) => {
  try {
    const { message, context } = req.body || {};
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
    
    messages.push({ role: "user", content: message });

    // Use Chat Completions API with improved settings
    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages,
      temperature: 0.75,
      max_tokens: 400,
      top_p: 0.9,
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
