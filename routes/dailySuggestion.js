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

// ── AI ile 4 öğün üret ─────────────────────────────────────────────────────
async function generateMeals({ targetCal, language = "en", excludeNames = [] }) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const excludeClause = excludeNames.length
    ? (language === "tr"
        ? `Bu yemeklerden KAÇIN (bugün zaten önerildi): ${excludeNames.join(", ")}.`
        : `AVOID these (already suggested today): ${excludeNames.join(", ")}.`)
    : "";

  // Dağılım: kahvaltı %25, öğle %35, atıştırmalık %10, akşam %30
  const prompt = language === "tr"
    ? `
Günlük kalori hedefi: ${targetCal} kcal.
${excludeClause}

Bir günlük beslenme planı için 4 öğün öner: kahvaltı, öğle yemeği, atıştırmalık ve akşam yemeği.
Kalori dağılımı: kahvaltı ~%25 (${Math.round(targetCal*0.25)} kcal), öğle ~%35 (${Math.round(targetCal*0.35)} kcal), atıştırmalık ~%10 (${Math.round(targetCal*0.10)} kcal), akşam ~%30 (${Math.round(targetCal*0.30)} kcal).
Toplam yaklaşık ${targetCal} kcal olmalı. Yemekler sağlıklı, pratik ve Türk damak zevkine uygun olsun.

SADECE JSON döndür:
{
  "breakfast": { "name_tr": "", "name_en": "", "cal": 0, "protein": 0, "carbs": 0, "fat": 0 },
  "lunch":     { "name_tr": "", "name_en": "", "cal": 0, "protein": 0, "carbs": 0, "fat": 0 },
  "snack":     { "name_tr": "", "name_en": "", "cal": 0, "protein": 0, "carbs": 0, "fat": 0 },
  "dinner":    { "name_tr": "", "name_en": "", "cal": 0, "protein": 0, "carbs": 0, "fat": 0 }
}
`
    : `
Daily calorie target: ${targetCal} kcal.
${excludeClause}

Suggest 4 meals for one day: breakfast, lunch, snack, and dinner.
Calorie distribution: breakfast ~25% (${Math.round(targetCal*0.25)} kcal), lunch ~35% (${Math.round(targetCal*0.35)} kcal), snack ~10% (${Math.round(targetCal*0.10)} kcal), dinner ~30% (${Math.round(targetCal*0.30)} kcal).
Total should be approximately ${targetCal} kcal. Meals should be healthy, practical, and balanced.

RETURN ONLY JSON:
{
  "breakfast": { "name_tr": "", "name_en": "", "cal": 0, "protein": 0, "carbs": 0, "fat": 0 },
  "lunch":     { "name_tr": "", "name_en": "", "cal": 0, "protein": 0, "carbs": 0, "fat": 0 },
  "snack":     { "name_tr": "", "name_en": "", "cal": 0, "protein": 0, "carbs": 0, "fat": 0 },
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
    snack:     language === "tr" ? "atıştırmalık" : "snack",
    dinner:    language === "tr" ? "akşam yemeği" : "dinner",
  }[mealType] || mealType;

  const excludeClause = excludeName
    ? (language === "tr" ? `"${excludeName}" dışında farklı bir şey öner.` : `Suggest something different from "${excludeName}".`)
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

const MEAL_TYPES = ["breakfast", "lunch", "snack", "dinner"];

// Öğün kalori oranları
const MEAL_RATIOS = { breakfast: 0.25, lunch: 0.35, snack: 0.10, dinner: 0.30 };

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/daily-suggestion
// Bugünkü öneriyi getirir; yoksa AI ile üretir.
// Query: language, targetCal (kullanıcının manual hedefi varsa)
// ══════════════════════════════════════════════════════════════════════════════
router.get("/daily-suggestion", authMiddleware, async (req, res) => {
  try {
    const language = req.query.language || "en";
    const today = new Date().toISOString().split("T")[0];

    // Bugün için kayıt zaten var mı?
    let doc = await DailySuggestion.findOne({ userId: req.userId, date: today });
    if (doc) {
      // Eski kayıt snack içermiyorsa ekle
      if (!doc.snack || !doc.snack.name_en) {
        const snackCal = Math.round(doc.targetCal * 0.10);
        const snackMeal = await generateOneMeal({ mealType: "snack", targetCal: snackCal, language });
        doc.snack = { ...snackMeal, confirmed: false };
        doc.markModified("snack");
        await doc.save();
      }
      return res.json({ suggestion: doc, cached: true });
    }

    // Kalori hedefi: frontend'den gelen manuel hedef veya TDEE hesabı
    let targetCal = req.query.targetCal ? parseInt(req.query.targetCal, 10) : 0;
    if (!targetCal || isNaN(targetCal)) {
      const user = await User.findById(req.userId);
      targetCal = calcTDEE(user);
    }

    // AI ile üret
    const meals = await generateMeals({ targetCal, language });

    doc = await DailySuggestion.create({
      userId: req.userId,
      date: today,
      targetCal,
      breakfast: meals.breakfast || {},
      lunch:     meals.lunch     || {},
      snack:     meals.snack     || {},
      dinner:    meals.dinner    || {},
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
// Body: { mealType: "breakfast"|"lunch"|"snack"|"dinner" }
// ══════════════════════════════════════════════════════════════════════════════
router.post("/daily-suggestion/confirm", authMiddleware, async (req, res) => {
  try {
    const { mealType } = req.body;
    if (!MEAL_TYPES.includes(mealType)) {
      return res.status(400).json({ error: "Geçersiz öğün tipi" });
    }

    const today = new Date().toISOString().split("T")[0];
    const doc = await DailySuggestion.findOne({ userId: req.userId, date: today });
    if (!doc) return res.status(404).json({ error: "Bugün için öneri bulunamadı" });

    const meal = doc[mealType];
    if (!meal || meal.confirmed) {
      return res.json({ success: true, alreadyConfirmed: true });
    }

    const todayDate = new Date().toISOString().split("T")[0];

    // Meals koleksiyonuna logla
    await Meal.create({
      userId: req.userId,
      image: "ai-suggestion",
      date: todayDate,
      foods: [{
        name: meal.name_en || meal.name_tr,
        calories: meal.cal,
        protein: meal.protein,
        fat: meal.fat,
        carbs: meal.carbs,
        gramage: 0,
      }],
      totalCalories: meal.cal,
      totalProtein: meal.protein,
      totalFat: meal.fat,
      totalCarbs: meal.carbs,
      mealName: meal.name_en || meal.name_tr,
      mealType,
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
// Body: { mealType, language? }
// ══════════════════════════════════════════════════════════════════════════════
router.post("/daily-suggestion/swap", authMiddleware, async (req, res) => {
  try {
    const { mealType, language = "en" } = req.body;
    if (!MEAL_TYPES.includes(mealType)) {
      return res.status(400).json({ error: "Geçersiz öğün tipi" });
    }

    const today = new Date().toISOString().split("T")[0];
    const doc = await DailySuggestion.findOne({ userId: req.userId, date: today });
    if (!doc) return res.status(404).json({ error: "Bugün için öneri bulunamadı" });

    if (doc[mealType]?.confirmed) {
      return res.status(400).json({ error: "Onaylanmış öğün değiştirilemez" });
    }

    const mealTargetCal = Math.round(doc.targetCal * (MEAL_RATIOS[mealType] || 0.25));
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
// Tüm günü sıfırdan yeniden üret.
// Body: { language?, targetCal? }
// ══════════════════════════════════════════════════════════════════════════════
router.post("/daily-suggestion/regenerate", authMiddleware, async (req, res) => {
  try {
    const { language = "en" } = req.body;
    let targetCal = req.body.targetCal ? parseInt(req.body.targetCal, 10) : 0;
    const today = new Date().toISOString().split("T")[0];

    if (!targetCal || isNaN(targetCal)) {
      const user = await User.findById(req.userId);
      targetCal = calcTDEE(user);
    }

    // Önceki öneri isimlerini exclude et
    const existing = await DailySuggestion.findOne({ userId: req.userId, date: today });
    const excludeNames = [];
    if (existing) {
      MEAL_TYPES.forEach((m) => {
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
        snack:     { ...meals.snack,     confirmed: false },
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
