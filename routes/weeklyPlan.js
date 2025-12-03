import { Router } from "express";
import OpenAI from "openai";
import { WeeklyPlanModel } from "../models/WeeklyPlan.js";
import { User } from "../models/User.js";
import jwt from "jsonwebtoken";

const router = Router();

const JWT_SECRET =
  "d5f721491a7b51a3c83511efd6457e87729f100ee8f2c3191e4f4384c45f373a2f880ac2fef1fb574d43a4f80e9f4181010b925059da21a0a994e895c01ba0eb";

// AUTH MIDDLEWARE
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Token yok" });

  const token = authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Token yok" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.id;
    req.isPremium = decoded.isPremium || false;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Geçersiz token" });
  }
};
function getWeekNumber(date) {
  const temp = new Date(date.getFullYear(), 0, 1);
  return Math.ceil(((date - temp) / 86400000 + temp.getDay() + 1) / 7);
}
function getWeekDates(startDate) {
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString());
  }
  return dates;
}

// ====================== WEEKLY PLAN CREATE ===========================
// ====================== WEEKLY PLAN CREATE ===========================
router.post("/weekly-plan", authMiddleware, async (req, res) => {
  const {
  weight,
  height,
  age,
  gender,
  activityLevel,
  goal,
  dietMode,
  forbiddenFoods,
  language = "tr"
} = req.body;


  try {
    const user = await User.findById(req.userId);

    // ---------------- FREE LIMIT ----------------
    const today = new Date();
    const year = today.getFullYear();
    const week = getWeekNumber(today);
    const yearWeek = `${year}-${week}`;

    if (!user.isPremium) {
      if (user.lastPlanDate === yearWeek && user.weeklyPlanCount >= 5) {
        return res.status(403).json({
          error: "FREE_LIMIT",
          message:
            language === "en"
              ? "Free users can only generate 1 weekly plan per week."
              : "Ücretsiz kullanıcılar haftada yalnızca 1 haftalık plan oluşturabilir.",
        });
      }

      // Yeni hafta → sıfırla
      if (user.lastPlanDate !== yearWeek) {
        user.lastPlanDate = yearWeek;
        user.weeklyPlanCount = 0;
      }

      user.weeklyPlanCount++;
      await user.save();
    }

    // ---------------- DAILY NAME (DİL DESTEKLİ) ----------------
    const daysTR = [
      "Pazar",
      "Pazartesi",
      "Salı",
      "Çarşamba",
      "Perşembe",
      "Cuma",
      "Cumartesi",
    ];

    const daysEN = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];

    const todayName =
      language === "en"
        ? daysEN[new Date().getDay()]
        : daysTR[new Date().getDay()];

    // ---------------- PREVIOUS PLAN TEXT ----------------
    const lastPlan = await WeeklyPlanModel.findOne({ userId: req.userId }).sort({
      createdAt: -1,
    });

    let previousMealsText = "";
    if (lastPlan) {
      if (language === "en") {
        previousMealsText =
          "These meals were used in the previous week, do NOT repeat them:\n";
      } else {
        previousMealsText =
          "Önceki haftada şu yemekler verildi, lütfen tekrar etme:\n";
      }

      previousMealsText += lastPlan.plan
        .map(
          (day) => `
${day.day}:
Breakfast: ${day.breakfast}
Lunch: ${day.lunch}
Dinner: ${day.dinner}
Snacks: ${day.snacks}
`
        )
        .join("\n");
    }

    // ---------------- PROMPT (TR & EN) ----------------
const promptTR = `
Sen profesyonel bir diyetisyen ve beslenme uzmanısın.

Kullanıcı bilgileri:
- Kilo: ${weight} kg
- Boy: ${height} cm
- Yaş: ${age}
- Cinsiyet: ${gender}
- Aktivite seviyesi: ${activityLevel}
- Diyet türü: ${dietMode}
- Hedef: ${goal}
- Yasaklı besinler: ${forbiddenFoods || "yok"}

Bu bilgilere göre önce kullanıcının:
- BMR (bazal metabolizma hızı)
- TDEE (günlük kalori ihtiyacı)
- hedefe göre (kilo verme / alma / kas yapma) ayarlanmış günlük hedef kalorisi
- makro dağılımı (protein / yağ / karbonhidrat)

hesapla.

‼ YEMEK PLANLARI KURALLARI ‼
- 7 günlük plan oluştur.
- Her öğün *EN AZ 2–3 bileşenli* olmalı.
- Tek kelimelik yemek adı YASAK.
- Öğün formatı: “sebzeli omlet + beyaz peynir + domates”
- Her gün *farklı* yemekler olmalı (asla tekrar yok).
- Et/tavuk/balık *haftada en fazla 3 gün* olabilir.
- Yasaklı besinler kesinlikle yer almamalı.
- Kaloriler GERÇEKÇİ olmalı.
- Makrolar günlük hedeflere uygun olmalı.

‼ ÇIKTI KURALLARI ‼
- SADECE ham JSON döndür.
- Kod bloğu, açıklama, markdown yok.
- Her gün için:
{
  "day": "Pazartesi",
  "breakfast": "",
  "breakfast_cal": 0,
  "lunch": "",
  "lunch_cal": 0,
  "dinner": "",
  "dinner_cal": 0,
  "snacks": "",
  "snacks_cal": 0,
  "total_cal": 0,
  "total_protein": 0,
  "total_fat": 0,
  "total_carbs": 0
}

Plan bugün başlamalı: ${todayName}

Önceki hafta tekrar etme:
${previousMealsText}
`;

const promptEN = `
You are a professional dietitian and nutrition specialist.

User info:
- Weight: ${weight} kg
- Height: ${height} cm
- Age: ${age}
- Gender: ${gender}
- Activity level: ${activityLevel}
- Diet type: ${dietMode}
- Goal: ${goal}
- Forbidden foods: ${forbiddenFoods || "none"}

First calculate:
- BMR (Basal Metabolic Rate)
- TDEE
- Goal-adjusted daily calorie target
- Macro distribution (protein, fat, carbs)

‼ MEAL PLAN RULES ‼
- Generate a 7-day meal plan.
- Every meal must contain AT LEAST 2–3 components.
- Single-word foods are FORBIDDEN.
- Each day must contain completely different meals.
- Meat/poultry/fish allowed only 3 days/week.
- Forbidden foods must NEVER appear.
- Calories must be realistic.
- Macros must match the user’s goal.

‼ OUTPUT RULES ‼
Return ONLY raw JSON.
NO markdown, NO explanation.

Each day must follow the format:
{
  "day": "Monday",
  "breakfast": "",
  "breakfast_cal": 0,
  "lunch": "",
  "lunch_cal": 0,
  "dinner": "",
  "dinner_cal": 0,
  "snacks": "",
  "snacks_cal": 0,
  "total_cal": 0,
  "total_protein": 0,
  "total_fat": 0,
  "total_carbs": 0
}

Start from today: ${todayName}

Do NOT repeat meals from last week:
${previousMealsText}
`;


    // Diline göre prompt seç
    const finalPrompt = language === "en" ? promptEN : promptTR;

    // ---------------- OPENAI CALL ----------------
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const completion = await client.responses.generate({
      model: "gpt-5.1-mini",
      input: finalPrompt,
      max_completion_tokens: 3000,
    });

    // OUTPUT (her zaman bu değişkende)
    const jsonText = completion.output_text;

    // Burada model RAW JSON döndürür → direkt parse ediyoruz
    const data = JSON.parse(jsonText);

    // ---------------- SAVE PLAN ----------------
    const weekDates = getWeekDates(new Date());

    const finalDays = data.days.map((day, idx) => ({
      ...day,
      date: weekDates[idx],   // ⭐ her gün kendi tarihine sahip
    }));

    const plan = await WeeklyPlanModel.create({
      userId: req.userId,
      forbiddenFoods: forbiddenFoods
        ? forbiddenFoods.split(",").map((x) => x.trim())
        : [],
      plan: finalDays,
    });


    return res.json({ program: plan.plan, createdAt: plan.createdAt });
  } catch (err) {
    console.log(err);
    return res.status(500).json({
      error:
        language === "en"
          ? "Failed to generate plan"
          : "Plan oluşturulamadı",
    });
  }
});

// ====================== GET LAST PLAN ===========================
router.get("/weekly-plan/last", authMiddleware, async (req, res) => {
  try {
    const lastPlan = await WeeklyPlanModel.findOne({ userId: req.userId }).sort({
      createdAt: -1
    });

    if (!lastPlan) return res.json({ program: null });

    res.json({
      program: lastPlan.plan,
      createdAt: lastPlan.createdAt
    });
  } catch (err) {
    res.status(500).json({ error: "Plan çekilemedi" });
  }
});

// ====================== GET HISTORY ===========================
router.get("/weekly-plan/history", authMiddleware, async (req, res) => {
  try {
    const plans = await WeeklyPlanModel.find({ userId: req.userId }).sort({
      createdAt: -1
    });

    res.json({ plans });
  } catch (err) {
    res.status(500).json({ error: "Planlar alınamadı" });
  }
});

// ====================== UPDATE DAY (PREMIUM ONLY) ===========================
router.post("/weekly-plan/update-day", authMiddleware, async (req, res) => {
  if (!req.isPremium) {
    return res.json({
      error: "Bu özellik Premium kullanıcılar içindir."
    });
  }

  try {
    const { dayData } = req.body;

    const planDoc = await WeeklyPlanModel.findOne({ userId: req.userId }).sort({
      createdAt: -1
    });

    if (!planDoc) return res.status(404).json({ error: "Plan bulunamadı" });

    const index = planDoc.plan.findIndex(d => d.day === dayData.day);
    if (index === -1)
      return res.status(404).json({ error: "Gün bulunamadı" });

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const nutritionPrompt = `
Bu öğünlere göre kalorileri profesyonel diyetisyen gibi hesapla:

Kahvaltı: ${dayData.breakfast}
Öğle: ${dayData.lunch}
Akşam: ${dayData.dinner}
Atıştırmalık: ${dayData.snacks}

Sadece JSON:
{
 "breakfast_cal": 0,
 "lunch_cal": 0,
 "dinner_cal": 0,
 "snacks_cal": 0,
 "total_cal": 0,
 "total_protein": 0,
 "total_fat": 0,
 "total_carbs": 0
}`;

const completion = await client.responses.generate({
  model: "gpt-5.1-mini",
  input: nutritionPrompt,
  max_completion_tokens: 1000,
});

const nut = JSON.parse(completion.output_text);

    const updated = { ...dayData, ...nut };

    planDoc.plan[index] = updated;

    await planDoc.save();

    res.json({ success: true, updatedDay: updated });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Gün düzenlenemedi" });
  }
});
router.get("/plan/test", (req, res) => {
  res.json({ ok: true, message: "Auth route çalışıyor" });
});
export const weeklyPlanRoute = router;
