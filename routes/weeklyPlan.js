import { Router } from "express";
import OpenAI from "openai";
import { WeeklyPlanModel } from "../models/WeeklyPlan.js";
import { User } from "../models/User.js";
import jwt from "jsonwebtoken";
import { Recipe } from "../models/Recipe.js";

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
function normalizeIngredients(ingredients) {
  return ingredients.map(item => {
    if (typeof item === "string") {
      const parts = item.split("(");
      return {
        ingredient: parts[0].trim(),
        amount: parts[1] ? parts[1].replace(")", "").trim() : ""
      };
    }
    return item;
  });
}

// ====================== WEEKLY PLAN CREATE ===========================
// ====================== WEEKLY PLAN CREATE ===========================
router.post("/weekly-plan", authMiddleware, async (req, res) => {
  const { forbiddenFoods, language = "tr", cuisine = "turkish" } = req.body;

  try {
    const user = await User.findById(req.userId);

    // ---------------- FREE LIMIT ----------------
    const today = new Date();
    const year = today.getFullYear();
    const week = getWeekNumber(today);
    const yearWeek = `${year}-${week}`;

    if (!user.isPremium) {
      if (user.lastPlanDate === yearWeek && user.weeklyPlanCount >= 5555) {
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
7 günlük yemek planı oluştur.
Seçilen dünya mutfağı: ${cuisine} 

Bu mutfağın yemek kültürüne uygun tarifler üret.
Yasaklı besinler: ${forbiddenFoods || "yok"}

‼ KRİTİK ZORUNLU KURALLAR ‼
- Her öğün EN AZ 2–3 yemekten oluşmalıdır.
- TEK KELİMELİ yemek adı YASAKTIR (ör: sadece "kinoa", "pilav", "makarna" OLAMAZ).
  Örnek isimler:
    - "Kinoa salatası"
    - "Tavuk sote"
    - "Sebzeli bulgur pilavı"
    - "Yoğurtlu nohut"

- ÖĞÜN YAZIM FORMATI ÇOK KRİTİK:
  ✅ DOĞRU:
    "Tavuk sote + pirinç pilavı + yoğurt"
    "Mercimek çorbası + zeytinyağlı fasulye + tam buğday ekmeği"
    "Sebzeli omlet + beyaz peynir + domates"
    "Kremalı mantarlı makarna + yeşil salata"
  ❌ YANLIŞ:
    "Tavuk sote ile pirinç pilavı + yoğurt"
    "Kremalı mantar soslu makarna ile salata"
    "Tavuk sote ve pirinç pilavı + yoğurt"

- Bileşenler arasındaki AYIRICI **sadece ve sadece " + "** olabilir.
- "ile" "ve" bağlaçları yerine KESİNLİKLE "+" kullan!!!!!
- Aynı yemekleri tekrar etme.
- Et/tavuk/balık haftada en fazla 3 gün olabilir.
- Gerçekçi kaloriler ve makrolar ekle.
- Yemek isimlerini düzgün ver, restoran menüsündeki veya insanların günlük kullandığı isimler olmalı.
  Özellikle:
    - "kremalı mantar soslu makarna ile salata" yerine
      "Kremalı mantarlı makarna + salata" yaz.

‼ ÇIKTI KURALLARI ‼
- Sadece ham JSON döndür.
- Kod bloğu kullanma.
- Markdown kullanma.
- Ekstra açıklama yazma.
- Tüm kaloriler ve makrolar sayı olmalı.

Plan bugün başlamalı: ${todayName}
Format (zorunlu):
{
  "days": [
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
  ]
}

${previousMealsText}
`;
const promptEN = `
Create a 7-day meal plan.
Selected world cuisine: ${cuisine}

Generate meals that match this cuisine.

‼ MANDATORY RULES ‼
- Each meal must contain 2–3+ components.
- Single-word food names are FORBIDDEN (e.g., "quinoa", "rice", "pasta" is NOT allowed).
  *Every component must contain AT LEAST 2 WORDS.*
  Examples:
    - "Quinoa salad"
    - "Chicken sauté"
    - "Vegetable bulgur pilaf"
    - "Yogurt with chickpeas"
- Meals must be written like:
  "Chicken sauté + rice pilaf + yogurt"
  "Lentil soup + green beans in olive oil + whole wheat bread"
  "Vegetable omelette + feta cheese + tomatoes"
- Do NOT repeat meals.
- Meat/poultry/fish max 3 days per week.
- Include realistic calories and macros.

‼ OUTPUT RULES ‼
- Output ONLY raw JSON.
- DO NOT add explanation.
- DO NOT use markdown.
- All calories/macros must be numbers.

Plan must start from today: ${todayName}

Format (must match exactly):
{
  "days": [
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
  ]
}

${previousMealsText}
`;


    // Diline göre prompt seç
    const finalPrompt = language === "en" ? promptEN : promptTR;

    // ---------------- OPENAI CALL ----------------
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: finalPrompt }],
      temperature: 0.9,
      max_tokens: 3000,
    });

    const data = JSON.parse(completion.choices[0].message.content);

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

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: nutritionPrompt }],
      response_format: { type: "json_object" }
    });

    const nut = JSON.parse(completion.choices[0].message.content);

    const updated = { ...dayData, ...nut };

    planDoc.plan[index] = updated;

    await planDoc.save();

    res.json({ success: true, updatedDay: updated });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Gün düzenlenemedi" });
  }
});
router.post("/weekly-plan/meal-detail", authMiddleware, async (req, res) => {
  try {
    const { mealText, language = "tr" } = req.body;

    if (!mealText || mealText.trim().length < 3)
      return res.status(400).json({ error: "Meal text missing" });

    const meals = mealText.split("+").map(m => m.trim());
    let finalRecipes = [];

    // Title-case function
    function toTitleCase(str) {
      return str
        .toLowerCase()
        .split(" ")
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
    }

    // 1) CACHE KONTROLÜ
    for (let meal of meals) {
      const searchName = toTitleCase(meal); // 🔥 Köfte Şiş formatına çevir

      const exist = await Recipe.findOne({ name: searchName });
      if (exist) {
        console.log("📌 Cache’den bulundu:", searchName);
        finalRecipes.push(exist);
      }
    }

    // 2) EKSİKLERİ BUL
    let missingMeals = meals.filter(meal => {
      const searchName = toTitleCase(meal);
      return !finalRecipes.find(r => r.name === searchName);
    });

    // 3) AI ÇAĞRISI GEREKİYORSA
    if (missingMeals.length > 0) {
      console.log("🚀 AI tarafından üretilecek:", missingMeals);

      const prompt =
        language === "en"
          ? `
Create detailed recipes. Meals: ${missingMeals.join(", ")}

Return ONLY JSON:
{
  "recipes":[
    {
      "name":"", 
      "ingredients":[ { "ingredient":"", "amount":"" } ],
      "steps":[ "" ]
    }
  ]
}
`
          : `
Bu yemeklerin her biri için ayrı tarif üret: ${missingMeals.join(", ")}
Virgülle ayrılmış yemeklerin hepsi ayrı yemeklerdir, birleştirme!!!
‼ KRİTİK KURAL ‼
Aşağıdaki türde bulunan yiyeceklere ASLA tarif üretme, ancak bir yemek içinde kullanılıyorsa üret:
- (ör: yoğurt, bal, zeytin, domates, turşu, peynir, salatalık, reçel, ekmek, lavaş)
- Zaten hazır tüketilen yiyecekler

Bu tür yiyecekler yemek DEĞİLDİR ve tarif gerektirmez.
Eğer sana sadece bu tarz yemek olmayan yiyecekler verildiyse boş json döndür.
Bir yemek tarifinin üretilebilmesi için:
- Bir pişirme/ hazırlama işlemi içermelidir.
Sadece JSON döndür, Format:
{
  "recipes":[
    {
      "name":"", 
      "ingredients":[ { "ingredient":"", "amount":"" } ],
      "steps":[ "" ]
    }
  ]
}
`;

      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      const completion = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" }
      });

      let data = JSON.parse(completion.choices[0].message.content);

      // 4) KAYDET VE EKLE
      for (const recipe of data.recipes) {
        const titleCased = toTitleCase(recipe.name);
        recipe.name = titleCased;

        recipe.ingredients = normalizeIngredients(recipe.ingredients);

        await Recipe.findOneAndUpdate(
          { name: titleCased },
          recipe,
          { upsert: true }
        );

        finalRecipes.push(recipe);
      }
    }

    return res.json({ recipes: finalRecipes });

  } catch (err) {
    console.log(err);
    return res.status(500).json({ error: "Recipe generation failed" });
  }
});

export const weeklyPlanRoute = router;
