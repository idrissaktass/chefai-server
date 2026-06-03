import { Router } from "express";
import OpenAI from "openai";
import jwt from "jsonwebtoken";
import { User } from "../models/User.js";
import { Meal } from "../models/Meal.js";
import { DailySuggestion } from "../models/DailySuggestion.js";

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET ||
  "d5f721491a7b51a3c83511efd6457e87729f100ee8f2c3191e4f4384c45f373a2f880ac2fef1fb574d43a4f80e9f4181010b925059da21a0a994e895c01ba0eb";

const authMiddleware = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "Token yok" });
  try {
    const decoded = jwt.verify(header.split(" ")[1], JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch {
    return res.status(401).json({ error: "Geçersiz token" });
  }
};

// ── TDEE hesaplama ──────────────────────────────────────────────────────────
const ACTIVITY = {
  sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, "very-active": 1.9,
};

function calcTDEE(user) {
  const { age, weight, height, gender, goal, activityLevel = "moderate" } = user;
  if (!age || !weight || !height || !gender) return 2000;

  const bmr = gender === "male"
    ? 10 * weight + 6.25 * height - 5 * age + 5
    : 10 * weight + 6.25 * height - 5 * age - 161;

  let tdee = bmr * (ACTIVITY[activityLevel] || 1.55);
  if (goal === "lose") tdee -= 500;
  if (goal === "gain") tdee += 300;
  if (goal === "muscle_gain") tdee += 400;
  return Math.round(tdee);
}

// ── AI ile öğün üret ────────────────────────────────────────────────────────
async function generateMeals({ targetCal, language = "en", excludeNames = [] }) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const excludeClause = excludeNames.length
    ? (language === "tr"
        ? `Bu yemeklerden KAÇIN (bugün zaten önerildi): ${excludeNames.join(", ")}.`
        : `AVOID these (already suggested today): ${excludeNames.join(", ")}.`)
    : "";

  const prompt = language === "tr"
    ? `
Günlük kalori hedefi: ${targetCal} kcal.
${excludeClause}

Bir günlük beslenme planı için 3 öğün öner: kahvaltı, öğle yemeği ve akşam yemeği.
Toplam kalori yaklaşık ${targetCal} kcal olmalı. Yemekler sağlıklı, pratik ve Türk damak zevkine uygun olsun.

SADECE JSON döndür:
{
  "breakfast": { "name_tr": "", "name_en": "", "cal": 0, "protein": 0, "carbs": 0, "fat": 0 },
  "lunch":     { "name_tr": "", "name_en": "", "cal": 0, "protein": 0, "carbs": 0, "fat": 0 },
  "dinner":    { "name_tr": "", "name_en": "", "cal": 0, "protein": 0, "carbs": 0, "fat": 0 }
}
`
    : `
Daily calorie target: ${targetCal} kcal.
${excludeClause}

Suggest 3 meals for one day: breakfast, lunch, and dinner.
Total calories should be approximately ${targetCal} kcal. Meals should be healthy, practical and balanced.

RETURN ONLY JSON:
{
  "breakfast": { "name_tr": "", "name_en": "", "cal": 0, "protein": 0, "carbs": 0, "fat": 0 },
  "lunch":     { "name_tr": "", "name_en": "", "cal": 0, "protein": 0, "carbs": 0, "fat": 0 },
  "dinner":    { "name_tr": "", "name_en": "", "cal": 0, "protein": 0, "carbs": 0, "fat": 0 }
}
`;

  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
  });

  return JSON.parse(completion.choices[0].message.content);
}

// ── AI ile tek öğün üret (swap için) ────────────────────────────────────────
async function generateOneMeal({ mealType, targetCal, language = "en", excludeName = "" }) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const mealLabel = {
    breakfast: language === "tr" ? "kahvaltı" : "breakfast",
    lunch:     language === "tr" ? "öğle yemeği" : "lunch",
    dinner:    language === "tr" ? "akşam yemeği" : "dinner",
  }[mealType] || mealType;

  const excludeClause = excludeName
    ? (language === "tr" ? `"${excludeName}" dışında farklı bir yemek öner.` : `Suggest something different from "${excludeName}".`)
    : "";

  const prompt = language === "tr"
    ? `
${mealLabel} için yaklaşık ${targetCal} kcal'lik tek bir öğün öner.
${excludeClause}
Sağlıklı, pratik ve Türk mutfağına uygun olsun.

SADECE JSON:
{ "name_tr": "", "name_en": "", "cal": 0, "protein": 0, "carbs": 0, "fat": 0 }
`
    : `
Suggest a single ${mealLabel} with approximately ${targetCal} kcal.
${excludeClause}
Healthy and practical.

RETURN ONLY JSON:
{ "name_tr": "", "name_en": "", "cal": 0, "protein": 0, "carbs": 0, "fat": 0 }
`;

  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
  });

  return JSON.parse(completion.choices[0].message.content);
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/daily-suggestion
// Bugünkü öneriyi getirir; yoksa AI ile üretir ve kaydeder.
// ══════════════════════════════════════════════════════════════════════════════
router.get("/daily-suggestion", authMiddleware, async (req, res) => {
  try {
    const language = req.query.language || "en";
    const today = new Date().toISOString().split("T")[0];

    // Bugün için kayıt zaten var mı?
    let doc = await DailySuggestion.findOne({ userId: req.userId, date: today });
    if (doc) return res.json({ suggestion: doc, cached: true });

    // Kullanıcı profilinden TDEE hesapla
    const user = await User.findById(req.userId);
    const targetCal = calcTDEE(user);

    // AI ile üret
    const meals = await generateMeals({ targetCal, language });

    doc = await DailySuggestion.create({
      userId: req.userId,
      date: today,
      targetCal,
      breakfast: meals.breakfast || {},
      lunch: meals.lunch || {},
      dinner: meals.dinner || {},
    });

    return res.json({ suggestion: doc, cached: false });
  } catch (err) {
    console.error("daily-suggestion GET error:", err);
    return res.status(500).json({ error: "Öneri oluşturulamadı" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/daily-suggestion/confirm
// Öğünü "yedim" olarak işaretle ve meals koleksiyonuna kaydet.
// Body: { mealType: "breakfast" | "lunch" | "dinner", image?: string }
// ══════════════════════════════════════════════════════════════════════════════
router.post("/daily-suggestion/confirm", authMiddleware, async (req, res) => {
  try {
    const { mealType, image = "" } = req.body;
    if (!["breakfast", "lunch", "dinner"].includes(mealType)) {
      return res.status(400).json({ error: "Geçersiz öğün tipi" });
    }

    const today = new Date().toISOString().split("T")[0];
    const doc = await DailySuggestion.findOne({ userId: req.userId, date: today });
    if (!doc) return res.status(404).json({ error: "Bugün için öneri bulunamadı" });

    const meal = doc[mealType];
    if (!meal || meal.confirmed) {
      return res.json({ success: true, alreadyConfirmed: true });
    }

    // Meals koleksiyonuna logla
    await Meal.create({
      userId: req.userId,
      image: image || "",
      date: new Date().toISOString(),
      foods: [{ name: meal.name_en || meal.name_tr, calories: meal.cal, protein: meal.protein, fat: meal.fat, carbs: meal.carbs, gramage: 0 }],
      totalCalories: meal.cal,
      totalProtein: meal.protein,
      totalFat: meal.fat,
      totalCarbs: meal.carbs,
      mealName: meal.name_en || meal.name_tr,
      mealType: mealType === "dinner" ? "dinner" : mealType === "breakfast" ? "breakfast" : "lunch",
    });

    // Öneriyi confirmed olarak işaretle
    doc[mealType] = { ...meal.toObject(), confirmed: true };
    doc.markModified(mealType);
    await doc.save();

    return res.json({ success: true });
  } catch (err) {
    console.error("daily-suggestion confirm error:", err);
    return res.status(500).json({ error: "Onaylanamadı" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/daily-suggestion/swap
// Bir öğün için yeni AI önerisi üret.
// Body: { mealType: "breakfast" | "lunch" | "dinner", language?: string }
// ══════════════════════════════════════════════════════════════════════════════
router.post("/daily-suggestion/swap", authMiddleware, async (req, res) => {
  try {
    const { mealType, language = "en" } = req.body;
    if (!["breakfast", "lunch", "dinner"].includes(mealType)) {
      return res.status(400).json({ error: "Geçersiz öğün tipi" });
    }

    const today = new Date().toISOString().split("T")[0];
    const doc = await DailySuggestion.findOne({ userId: req.userId, date: today });
    if (!doc) return res.status(404).json({ error: "Bugün için öneri bulunamadı" });

    if (doc[mealType]?.confirmed) {
      return res.status(400).json({ error: "Onaylanmış öğün değiştirilemez" });
    }

    // Her öğünün yaklaşık oranları
    const ratios = { breakfast: 0.28, lunch: 0.35, dinner: 0.37 };
    const mealTargetCal = Math.round(doc.targetCal * ratios[mealType]);
    const currentName = doc[mealType]?.name_en || doc[mealType]?.name_tr || "";

    const newMeal = await generateOneMeal({ mealType, targetCal: mealTargetCal, language, excludeName: currentName });

    doc[mealType] = { ...newMeal, confirmed: false };
    doc.markModified(mealType);
    await doc.save();

    return res.json({ success: true, meal: doc[mealType], suggestion: doc });
  } catch (err) {
    console.error("daily-suggestion swap error:", err);
    return res.status(500).json({ error: "Değiştirilemedi" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/daily-suggestion/regenerate
// Tüm günü sıfırdan yeniden üret (kullanıcı "Yenile" derse).
// ══════════════════════════════════════════════════════════════════════════════
router.post("/daily-suggestion/regenerate", authMiddleware, async (req, res) => {
  try {
    const { language = "en" } = req.body;
    const today = new Date().toISOString().split("T")[0];

    const user = await User.findById(req.userId);
    const targetCal = calcTDEE(user);

    // Önceki öneriyi al — confirmed olanlar için isimleri exclude et
    const existing = await DailySuggestion.findOne({ userId: req.userId, date: today });
    const excludeNames = [];
    if (existing) {
      ["breakfast", "lunch", "dinner"].forEach((m) => {
        const meal = existing[m];
        if (meal?.name_en) excludeNames.push(meal.name_en);
      });
    }

    const meals = await generateMeals({ targetCal, language, excludeNames });

    const doc = await DailySuggestion.findOneAndUpdate(
      { userId: req.userId, date: today },
      {
        targetCal,
        breakfast: { ...meals.breakfast, confirmed: false },
        lunch:     { ...meals.lunch,     confirmed: false },
        dinner:    { ...meals.dinner,    confirmed: false },
      },
      { upsert: true, new: true }
    );

    return res.json({ suggestion: doc });
  } catch (err) {
    console.error("daily-suggestion regenerate error:", err);
    return res.status(500).json({ error: "Yenilenemedi" });
  }
});

export const dailySuggestionRoute = router;
