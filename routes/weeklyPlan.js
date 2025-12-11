import { Router } from "express";
import OpenAI from "openai";
import { WeeklyPlanModel } from "../models/WeeklyPlan.js";
import { User } from "../models/User.js";
import jwt from "jsonwebtoken";
import { Recipe } from "../models/Recipe.js";
import fs from "fs";
import path from "path";

const mealsPath = path.join(process.cwd(), "utils", "normal.json");

const mealsData = JSON.parse(fs.readFileSync(mealsPath, "utf-8"));

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
    console.log("decoded",decoded)
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
function getNext7Days(startDate) {
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    days.push(d.toISOString());
  }
  return days;
}
// 🔥 Eski planlarda çakışan tarihleri sil
async function removeOverlappingDays(userId, newDates) {
  const oldPlans = await WeeklyPlanModel.find({ userId }).sort({ createdAt: 1 });

  const normalizedSet = new Set(
    newDates.map(d => new Date(d).toISOString().slice(0, 10))
  );

  for (let plan of oldPlans) {
    // Filtrele: eski planın içindeki günlerden yeni tarihlerle çakışmayanlar kalsın
    const filteredDays = plan.plan.filter(oldDay => {
      const oldDateNormalized = oldDay.date.slice(0, 10);
      return !normalizedSet.has(oldDateNormalized);  // ÇAKIŞANLARI SİL
    });

    plan.plan = filteredDays;

    // Eğer tamamen boşaldıysa dokümanı silebilirsin (opsiyonel)
    if (filteredDays.length === 0) {
      await WeeklyPlanModel.findByIdAndDelete(plan._id);
    } else {
      await plan.save();
    }
  }
}


function calculateCalories(age, gender, weight, height, goal) {
  let BMR;

  if (gender === "male") {
    BMR = 10 * weight + 6.25 * height - 5 * age + 5;
  } else {
    BMR = 10 * weight + 6.25 * height - 5 * age - 161;
  }

  let TDEE = BMR * 1.55; // orta aktif

  if (goal === "lose") TDEE -= 300;
  if (goal === "gain") TDEE += 300;

  return Math.round(TDEE);
}

function rotateWeekToToday(dayNamesTR, dayNamesEN) {
  const todayIndex = new Date().getDay(); // 0 = Pazar, 1 = Pazartesi ...
  
  // TR için (bizim dayNamesTR Pazartesi ile başlıyor, onu Pazar başlangıcına çevirmeliyiz)
  const mapTR = ["Pazar","Pazartesi","Salı","Çarşamba","Perşembe","Cuma","Cumartesi"];
  const shiftTR = mapTR[todayIndex]; 

  const startIndexTR = dayNamesTR.indexOf(shiftTR);
  const rotatedTR = [
    ...dayNamesTR.slice(startIndexTR),
    ...dayNamesTR.slice(0, startIndexTR),
  ];

  // EN için
  const rotatedEN = [
    ...dayNamesEN.slice(todayIndex),
    ...dayNamesEN.slice(0, todayIndex),
  ];

  return { rotatedTR, rotatedEN };
}

router.post("/weekly-plan", authMiddleware, async (req, res) => {
  try {
    const { age, gender, weight, height, goal, dietMode = "normal", forbiddenFoods = "", language = "" } = req.body;
const userId = req.userId;
    const calories = calculateCalories(age, gender, weight, height, goal);
    console.log("diet mod", dietMode)
    // Yemek filtreleme
    const breakfasts = mealsData.filter(
      m => m.mealTime === "breakfast" && m.diet.includes(dietMode)
    );
    const lunches = mealsData.filter(
      m => m.mealTime === "lunch" && m.diet.includes(dietMode)
    );
    const dinners = mealsData.filter(
      m => m.mealTime === "dinner" && m.diet.includes(dietMode)
    );
    const snacks = mealsData.filter(
      m => m.mealTime === "snacks" && m.diet.includes(dietMode)
    );

    const days = [];
    const dayNames = [
      "Pazartesi",
      "Salı",
      "Çarşamba",
      "Perşembe",
      "Cuma",
      "Cumartesi",
      "Pazar"
    ];

    function pickMeal(meals, target) {
      const options = meals.filter(
        m => Math.abs(m.kcal - target) <= 150
      );
      if (options.length === 0) return null;
      return options[Math.floor(Math.random() * options.length)];
    }
const startDate = new Date();  // 🔥 Bugün

for (let i = 0; i < 7; i++) {

  // 🔥 Günün tarihini oluştur
  const dayDate = new Date(startDate);
  dayDate.setDate(startDate.getDate() + i);

  const breakfast = pickMeal(breakfasts, calories * 0.25);
  const lunch = pickMeal(lunches, calories * 0.35);
  const dinner = pickMeal(dinners, calories * 0.30);
  const snack = pickMeal(snacks, calories * 0.10);


      const total =
        (breakfast?.kcal || 0) +
        (lunch?.kcal || 0) +
        (dinner?.kcal || 0) +
        (snack?.kcal || 0);

      const totalProtein =
        (breakfast?.protein || 0) +
        (lunch?.protein || 0) +
        (dinner?.protein || 0) +
        (snack?.protein || 0);

      const totalCarbs =
        (breakfast?.carbs || 0) +
        (lunch?.carbs || 0) +
        (dinner?.carbs || 0) +
        (snack?.carbs || 0);

      const totalFat =
        (breakfast?.fat || 0) +
        (lunch?.fat || 0) +
        (dinner?.fat || 0) +
        (snack?.fat || 0);

const dayNamesTR = ["Pazartesi","Salı","Çarşamba","Perşembe","Cuma","Cumartesi","Pazar"];
const dayNamesEN = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];

const { rotatedTR, rotatedEN } = rotateWeekToToday(dayNamesTR, dayNamesEN);

days.push({
  date: dayDate.toISOString(),  // 🔥 ZORUNLU ALAN
  
  day_tr: rotatedTR[i],
  day_en: rotatedEN[i],
  day: language === "en" ? rotatedEN[i] : rotatedTR[i],

  breakfast_tr: breakfast?.name_tr || "",
  breakfast_en: breakfast?.name_en || "",
  lunch_tr: lunch?.name_tr || "",
  lunch_en: lunch?.name_en || "",
  dinner_tr: dinner?.name_tr || "",
  dinner_en: dinner?.name_en || "",
  snack_tr: snack?.name_tr || "",
  snack_en: snack?.name_en || "",

  breakfast: language === "en" ? breakfast?.name_en : breakfast?.name_tr,
  lunch:     language === "en" ? lunch?.name_en : lunch?.name_tr,
  dinner:    language === "en" ? dinner?.name_en : dinner?.name_tr,
  snack:     language === "en" ? snack?.name_en : snack?.name_tr,

  breakfast_cal: breakfast?.kcal || 0,
  lunch_cal: lunch?.kcal || 0,
  dinner_cal: dinner?.kcal || 0,
  snack_cal: snack?.kcal || 0,

  total_cal: total,
  total_protein: totalProtein,
  total_carbs: totalCarbs,
  total_fat: totalFat,
});


    }

    // ✔️ DB’ye kaydet
    const savedPlan = await WeeklyPlanModel.create({
      userId,
      forbiddenFoods: forbiddenFoods ? forbiddenFoods.split(",") : [],
      dietMode,
      plan: days,
      shoppingList: [],
      createdAt: new Date(),
      date: new Date().toISOString()
    });

    return res.json({
      success: true,
      planId: savedPlan._id,
      days,
      targetCalories: calories
    });

  } catch (err) {
    console.log("Plan creation error:", err);
    return res.status(500).json({ error: "Plan could not be created" });
  }
});


router.get("/weekly-plan/last", authMiddleware, async (req, res) => {
  try {
    const language = req.query.language || "tr";
console.log("xd",language)

    const lastPlan = await WeeklyPlanModel.findOne({ userId: req.userId })
      .sort({ createdAt: -1 });

    if (!lastPlan) return res.json({ days: null });

    // Gün isimlerini dile göre dönüştür
    const converted = lastPlan.plan.map(d => ({
      ...d,
      day: language === "en" ? d.day_en : d.day_tr,
    }));

    return res.json({
      days: converted,
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
  // if (!req.isPremium) {
  //   return res.json({
  //     error: "Bu özellik Premium kullanıcılar içindir."
  //   });
  // }

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
    const { mealText, language = "tr", dietMode = "normal" } = req.body;

    if (!mealText || mealText.trim().length < 3)
      return res.status(400).json({ error: "Meal text missing" });

    const meals = mealText.split("+").map(m => m.trim());
    let finalRecipes = [];

    function toTitleCase(str) {
      return str
        .toLowerCase()
        .split(" ")
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
    }

    // 1) CACHE CHECK (dietMode + name)
    for (let meal of meals) {
      const baseName = toTitleCase(meal);

      const exist = await Recipe.findOne({
        name: baseName,
        dietMode: dietMode,  // 🔥 Artık prefix yok, burada arıyoruz
      });

      if (exist) finalRecipes.push(exist);
    }

    // 2) Missing recipes
    let missingMeals = meals.filter(meal => {
      const baseName = toTitleCase(meal);
      return !finalRecipes.find(r => r.name === baseName && r.dietMode === dietMode);
    });

    // 3) AI gerekli mi?
    if (missingMeals.length > 0) {
            console.log("🚀 AI tarafından üretilecek:", missingMeals);

const prompt =
  language === "en"
    ? `
Generate separate recipes for each of these meals: ${missingMeals.join(", ")}
Diet mode: ${dietMode}

Rules:
- Vegan → no animal products
- Vegetarian → no meat
- Keto → low carbohydrate
- Muscle_gain → high protein

Each item separated by commas is a DIFFERENT meal. Do NOT merge meals.

‼ CRITICAL RULE ‼
Never generate a recipe for items that are NOT actual dishes unless they are part of a real cooked meal.
Examples of items that are NOT recipes on their own:
- yogurt, honey, olives, tomatoes, pickles, cheese, cucumbers, jam, bread, tortilla
- any food that is already consumed as-is without cooking

If ALL provided items are not actual dishes (e.g., only yogurt, tomato, bread, cheese), return an empty JSON object.

To be considered a recipe:
- It must involve a cooking or preparation process (mixing, cooking, baking, boiling, sautéing, etc.)

Return ONLY JSON. No explanation, no markdown.

{
  "recipes":[
    {
      "name": "",
      "ingredients":[ { "ingredient": "", "amount": "" } ],
      "steps":[ "" ]
    }
  ]
}
`
    : `
Aşağıdaki yemekler için diyet tipine uygun tarif oluştur: ${missingMeals.join(", ")}
Diyet modu: ${dietMode}
Kurallar:
- Vegan → hayvansal ürün yok
- Vejetaryen → et yok
- Keto → düşük karbonhidrat
- Kas kazanımı → yüksek protein

Virgülle ayrılmış yemeklerin hepsi ayrı yemeklerdir, birleştirme!!!

‼ KRİTİK KURAL ‼
Aşağıdaki türde bulunan yiyeceklere ASLA tarif üretme, ancak bir yemek içinde kullanılıyorsa üret:
- (ör: yoğurt, bal, zeytin, domates, turşu, peynir, salatalık, reçel, ekmek, lavaş)
- Zaten hazır tüketilen yiyecekler

Bu tür yiyecekler yemek DEĞİLDİR ve tarif gerektirmez.
Eğer sana sadece bu tarz yemek olmayan yiyecekler verildiyse boş json döndür.

Bir yemek tarifinin üretilebilmesi için:
- Bir pişirme/ hazırlama işlemi içermelidir.

Sadece JSON döndür.
{
  "recipes":[
    {
      "name":"",
      "ingredients":[{"ingredient":"", "amount":""}],
      "steps":[""]
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

      // 4) Save to DB
      for (const recipe of data.recipes) {
        const baseName = toTitleCase(recipe.name);

        const dbRecipe = {
          name: baseName,
          dietMode,
          ingredients: normalizeIngredients(recipe.ingredients),
          steps: recipe.steps
        };

        const saved = await Recipe.findOneAndUpdate(
          { name: baseName, dietMode },
          dbRecipe,
          { upsert: true, new: true }
        );

        finalRecipes.push(saved);
      }
    }

    return res.json({ recipes: finalRecipes });

  } catch (err) {
    console.log(err);
    return res.status(500).json({ error: "Recipe generation failed" });
  }
});


export const weeklyPlanRoute = router;
