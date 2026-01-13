import { Router } from "express";
import OpenAI from "openai";
import { WeeklyPlanModel } from "../models/WeeklyPlan.js";
import { User } from "../models/User.js";
import jwt from "jsonwebtoken";
import { Recipe } from "../models/Recipe.js";
import fs from "fs";
import path from "path";
import axios from "axios";

const mealsPath = path.join(process.cwd(), "utils", "yeni.json");

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
const activityMultipliers = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  "very-active": 1.9,
};


function calculateCalories(
  age,
  gender,
  weight,
  height,
  goal,
  activityLevel = "moderate"
) {
  // BMR – Mifflin St Jeor
  const bmr =
    gender === "male"
      ? 10 * weight + 6.25 * height - 5 * age + 5
      : 10 * weight + 6.25 * height - 5 * age - 161;

  const multiplier = activityMultipliers[activityLevel] || 1.55;

  let tdee = bmr * multiplier;

  // 🎯 Goal ayarlamaları
  if (goal === "lose") tdee -= 500;
  if (goal === "gain") tdee += 300;
  if (goal === "maintain") tdee += 1;
  if (goal === "muscle_gain") tdee += 400;

  return Math.round(tdee);
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
    const { age, gender, weight, height, goal, dietMode = "normal", forbiddenFoods = "", language = "", activityLevel = "moderate" } = req.body;
    const userId = req.userId;
    const calories = calculateCalories(age, gender, weight, height, goal, activityLevel);
    console.log("Target Calories:", calories); // Konsol çıktısını güncelledim

    const matchesDiet = (meal) => {
      if (!meal.diet.includes(dietMode)) return false;

      if (goal === "muscle_gain") {
        return meal.diet.includes("muscle_gain") || meal.diet.includes("high-protein"); 
      }
      return true;
    };

    // Yemek filtreleme (Aynı kaldı)
    const breakfasts = mealsData.filter(m => m.mealTime === "breakfast" && matchesDiet(m));
    const lunches = mealsData.filter(m => m.mealTime === "lunch" && matchesDiet(m));
    const dinners = mealsData.filter(m => m.mealTime === "dinner" && matchesDiet(m));
    const snacks = mealsData.filter(m => m.mealTime === "snacks" && matchesDiet(m));


    const days = [];
    
    function pickMeal(meals, target) {
      const options = meals.filter(
        m => Math.abs(m.kcal - target) <= 150
      );
      if (options.length === 0) return null;
      return options[Math.floor(Math.random() * options.length)];
    }

    const startDate = new Date(); 

    for (let i = 0; i < 7; i++) {
      // 🔥 Günün tarihini oluştur
      const dayDate = new Date(startDate);
      dayDate.setDate(startDate.getDate() + i);

      let p_breakfast = 0.25;
      let p_lunch = 0.35;
      let p_dinner = 0.30;
      let p_snack_1 = 0.10;
      let p_snack_2 = 0;
      
      // 🎯 2800 kcal ve üzeri ise iki atıştırmalık ekle ve dağılımı ayarla
      if (calories >= 2500) {
        p_breakfast = 0.22; // %22
        p_lunch = 0.27;    // %30
        p_dinner = 0.26;   // %28
        p_snack_1 = 0.13;  // %10 (Snack 1)
        p_snack_2 = 0.12;  // %10 (Snack 2)
      }

      // Yüzdelere göre kalori hedeflerini belirle
      const target_breakfast = calories * p_breakfast;
      const target_lunch = calories * p_lunch;
      const target_dinner = calories * p_dinner;
      const target_snack_1 = calories * p_snack_1;
      const target_snack_2 = calories * p_snack_2;

      const breakfast = pickMeal(breakfasts, target_breakfast);
      const lunch = pickMeal(lunches, target_lunch);
      const dinner = pickMeal(dinners, target_dinner);
      const snack1 = pickMeal(snacks, target_snack_1); // Eski 'snack' yerine 'snack1'
      const snack2 = calories >= 2800 ? pickMeal(snacks, target_snack_2) : null; // Koşullu Snack 2 seçimi

      // ⚡ TOTAL HESAPLAMALARI (snack1 ve snack2 dahil edildi)
      const total =
        (breakfast?.kcal || 0) +
        (lunch?.kcal || 0) +
        (dinner?.kcal || 0) +
        (snack1?.kcal || 0) + 
        (snack2?.kcal || 0);

      const totalProtein =
        (breakfast?.protein || 0) +
        (lunch?.protein || 0) +
        (dinner?.protein || 0) +
        (snack1?.protein || 0) +
        (snack2?.protein || 0);

      const totalCarbs =
        (breakfast?.carbs || 0) +
        (lunch?.carbs || 0) +
        (dinner?.carbs || 0) +
        (snack1?.carbs || 0) +
        (snack2?.carbs || 0);

      const totalFat =
        (breakfast?.fat || 0) +
        (lunch?.fat || 0) +
        (dinner?.fat || 0) +
        (snack1?.fat || 0) +
        (snack2?.fat || 0);
      
      // rotateWeekToToday fonksiyonu bu scope'ta tanımlı değil, varsayalım globalde/import ile geliyor
      const dayNamesTR = ["Pazartesi","Salı","Çarşamba","Perşembe","Cuma","Cumartesi","Pazar"];
      const dayNamesEN = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
      const { rotatedTR, rotatedEN } = rotateWeekToToday(dayNamesTR, dayNamesEN);
  console.log("snack_2",snack1)
      days.push({
        date: dayDate.toISOString(),  // 🔥 ZORUNLU ALAN
        
        day_tr: rotatedTR[i],
        day_en: rotatedEN[i],
        day: language === "en" ? rotatedEN[i] : rotatedTR[i],

        breakfast_tr: breakfast?.name_tr || "",
        breakfast_en: breakfast?.name_en || "",
        lunch_tr: lunch?.name_tr || "",
        lunch_en: lunch?.name_en || "",
        dinner_tr: dinner?.name_tr || "",
        dinner_en: dinner?.name_en || "",
        
        // ⚡ SNACK 1 (Eski 'snack' alanlarını buraya haritalıyoruz)
        snack_tr: snack1?.name_tr || "",
        snack_en: snack1?.name_en || "",
        
        // ⚡ SNACK 2 (Yeni alanlar)
        snack2_tr: snack2?.name_tr || "", // 🔥 Yeni alan
        snack2_en: snack2?.name_en || "", // 🔥 Yeni alan

        breakfast: language === "en" ? breakfast?.name_en : breakfast?.name_tr,
        lunch:     language === "en" ? lunch?.name_en : lunch?.name_tr,
        dinner:    language === "en" ? dinner?.name_en : dinner?.name_tr,
        snack:     language === "en" ? snack1?.name_en : snack1?.name_tr, // Snack 1'i kullan
        snack2:    language === "en" ? snack2?.name_en : snack2?.name_tr, // 🔥 Yeni alan

        breakfast_cal: breakfast?.kcal || 0,
        lunch_cal: lunch?.kcal || 0,
        dinner_cal: dinner?.kcal || 0,
        snack_cal: snack1?.kcal || 0, // Snack 1'i kullan
        snack2_cal: snack2?.kcal || 0, // 🔥 Yeni alan

        total_cal: total,
        total_protein: totalProtein,
        total_carbs: totalCarbs,
        total_fat: totalFat,
breakfast_protein: breakfast?.protein || 0,
breakfast_carbs: breakfast?.carbs || 0,
breakfast_fat: breakfast?.fat || 0,

lunch_protein: lunch?.protein || 0,
lunch_carbs: lunch?.carbs || 0,
lunch_fat: lunch?.fat || 0,

dinner_protein: dinner?.protein || 0,
dinner_carbs: dinner?.carbs || 0,
dinner_fat: dinner?.fat || 0,

snack_protein: snack1?.protein || 0,
snack_carbs: snack1?.carbs || 0,
snack_fat: snack1?.fat || 0,

snack2_protein: snack2?.protein || 0,
snack2_carbs: snack2?.carbs || 0,
snack2_fat: snack2?.fat || 0,

      });
    }

    // ✔️ DB’ye kaydet (Aynı kaldı, 'plan: days' ile tüm yeni alanlar kaydedilecek)
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
      days, // Güncellenmiş plan verilerini döndür
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
    const language = req.query.language || "tr";

    const plans = await WeeklyPlanModel.find({ userId: req.userId })
      .sort({ createdAt: -1 });

    const convertedPlans = plans.map(plan => ({
      ...plan.toObject(),
      plan: plan.plan.map(d => ({
        ...d,
        day: language === "en" ? d.day_en : d.day_tr,
        breakfast: language === "en" ? d.breakfast_en : d.breakfast_tr,
        lunch: language === "en" ? d.lunch_en : d.lunch_tr,
        dinner: language === "en" ? d.dinner_en : d.dinner_tr,
        snacks: language === "en" ? d.snack_en : d.snack_tr,
      }))
    }));

    res.json({ plans: convertedPlans });
  } catch (err) {
    res.status(500).json({ error: "Planlar alınamadı" });
  }
});
router.post("/weekly-plan/update-meal", authMiddleware, async (req, res) => {
  try {
    const { day, mealType, text_tr, text_en } = req.body;

    // 🔒 Güvenlik
    const allowedMeals = ["breakfast", "lunch", "dinner", "snack", "snack2"];
    if (!allowedMeals.includes(mealType)) {
      return res.status(400).json({ error: "Geçersiz öğün tipi" });
    }

    const planDoc = await WeeklyPlanModel
      .findOne({ userId: req.userId })
      .sort({ createdAt: -1 });

    if (!planDoc) {
      return res.status(404).json({ error: "Plan bulunamadı" });
    }

    const dayIndex = planDoc.plan.findIndex(d => d.day === day);
    if (dayIndex === -1) {
      return res.status(404).json({ error: "Gün bulunamadı" });
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // 🧠 AI PROMPT – TEK ÖĞÜN
    const prompt = `
Aşağıdaki öğünün kalorilerini ve makrolarını,
klinik diyetisyen hassasiyetinde ve GERÇEKÇİ şekilde hesapla.

ZORUNLU KURALLAR:
- Zeytinyağı varsayımı yap:
  • 1 yemek kaşığı = 120 kcal
- Abartılı / sporcuya özel değerler VERME
- Diyetisyenlerin kullandığı ortalama değerleri kullan
- Makrolar kaloriyle MATEMATİKSEL olarak UYUMLU olsun

ÖĞÜN:
${text_tr}

SADECE JSON DÖN:
{
  "cal": number,
  "protein": number,
  "carbs": number,
  "fat": number
}
`;

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" }
    });

    const mealNut = JSON.parse(completion.choices[0].message.content);

    const dayObj = planDoc.plan[dayIndex];

    // ================================
    // 🔥 1️⃣ ÖĞÜNÜ GÜNCELLE
    // ================================
    dayObj[`${mealType}_tr`] = text_tr;
    dayObj[`${mealType}_en`] = text_en;

    dayObj[`${mealType}_cal`] = mealNut.cal;
    dayObj[`${mealType}_protein`] = mealNut.protein;
    dayObj[`${mealType}_carbs`] = mealNut.carbs;
    dayObj[`${mealType}_fat`] = mealNut.fat;

    // ================================
    // 🔄 2️⃣ GÜN TOPLAMLARINI YENİDEN HESAPLA
    // ================================
    const meals = ["breakfast", "lunch", "dinner", "snack", "snack2"];

    dayObj.total_cal = meals.reduce(
      (sum, m) => sum + (dayObj[`${m}_cal`] || 0),
      0
    );

    dayObj.total_protein = meals.reduce(
      (sum, m) => sum + (dayObj[`${m}_protein`] || 0),
      0
    );

    dayObj.total_carbs = meals.reduce(
      (sum, m) => sum + (dayObj[`${m}_carbs`] || 0),
      0
    );

    dayObj.total_fat = meals.reduce(
      (sum, m) => sum + (dayObj[`${m}_fat`] || 0),
      0
    );

    // ================================
    // 💾 3️⃣ DB KAYDET
    // ================================
    planDoc.plan[dayIndex] = dayObj;
    await planDoc.save();

    return res.json({
      success: true,
      updatedDay: dayObj
    });

  } catch (err) {
    console.error("update-meal error:", err);
    return res.status(500).json({ error: "Öğün güncellenemedi" });
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
Aşağıdaki öğünlerin kalorilerini ve makrolarını,
klinik diyetisyen hassasiyetinde ve GERÇEKÇİ şekilde hesapla.

ZORUNLU KURALLAR:
- Yağ kullanımını varsay:
  • Zeytinyağı: 1 yemek kaşığı = 120 kcal
- Abartılı veya sporcuya özel değerler VERME.
- Diyetisyenlerin kullandığı ortalama besin değerlerini kullan.
- Tüm makrolar toplam kaloriyle matematiksel olarak UYUMLU olsun.

ÖĞÜNLER:
Kahvaltı: ${dayData.breakfast}
Öğle: ${dayData.lunch}
Akşam: ${dayData.dinner}
Atıştırmalık: ${dayData.snacks}

ÇIKTI KURALI:
- SADECE JSON döndür
- Açıklama, yorum, metin ekleme

JSON FORMAT:
{
  "breakfast_cal": number,
  "lunch_cal": number,
  "dinner_cal": number,
  "snacks_cal": number,
  "total_cal": number,
  "total_protein": number,
  "total_fat": number,
  "total_carbs": number
}
`;


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
function similarityScore(recipeName, photoText) {
  if (!photoText) return 0;

  const words = recipeName.toLowerCase().split(" ");
  const text = photoText.toLowerCase();

  let matchCount = 0;

  words.forEach(w => {
    if (w.length > 2 && text.includes(w)) matchCount++;
  });

  return matchCount / words.length; // 0.0 - 1.0 arası skor
}

async function fetchRecipeImage(recipeName) {
  try {
    const PEXELS_KEY = "lxUXbL9YjqoUvBOIjlyU5Zk1AS7aiII4M9YcWeGxjPpnLOjPu1QYocSx";

    const response = await axios.get(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(
        recipeName + " food"
      )}&per_page=1`,
      {
        headers: { Authorization: PEXELS_KEY },
      }
    );

    const photo = response.data.photos?.[0];
    if (!photo) return null;

    const checkText = `${photo.alt} ${photo.photographer}`.trim();
    const score = similarityScore(recipeName, checkText);

    if (score < 0.1) return null;

    return photo.src.large;
  } catch (err) {
    console.log("Image fetch failed:", err.message);
    return null;
  }
}

router.post("/weekly-plan/meal-detail", authMiddleware, async (req, res) => {
  try {
    const { mealText, language = "tr", dietMode = "normal" } = req.body;
    if (!mealText || mealText.trim().length < 3)
      return res.status(400).json({ error: "Meal text missing" });

    const meals = mealText.split("+").map(m => m.trim());
    let finalRecipes = [];

      function toTitleCase(str) {
        // str undefined veya null ise, boş string döndür
        if (!str || typeof str !== 'string') {
          return ""; 
        }
        
        return str
          .toLowerCase()
          .split(" ")
          .map(w => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ");
      }

    // 1) CACHE CHECK (dietMode + name)
// 1️⃣ CACHE CHECK (AI + IMAGE ÖNCESİ)
    for (let meal of meals) {
      const baseName = toTitleCase(meal);

      const exist = await Recipe.findOne({
        name: baseName,
        dietMode
      });

      if (exist) {
        finalRecipes.push(exist); // ✅ direkt ekle
      }
    }


    // 2) Missing recipes
    let missingMeals = meals.filter(meal => {
      const baseName = toTitleCase(meal);
      return !finalRecipes.find(
        r => r.name === baseName && r.dietMode === dietMode
      );
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
      "steps":[ "" ],
       "prepTime": 0
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
      "steps":[""],
       "prepTime": 0
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
      for (let i = 0; i < data.recipes.length; i++) {
        const recipe = data.recipes[i];
        const prepTime =
        typeof recipe.prepTime === "number" && recipe.prepTime > 0
          ? recipe.prepTime
          : 10; // fallback


        // 🔒 ASIL İSİM: ilk gönderilen yemek ismi
        const originalMealName = toTitleCase(missingMeals[i]);

        // 🔥 RESİM BUL
        const imageUrl = await fetchRecipeImage(originalMealName);

        const dbRecipe = {
          name: originalMealName,
          dietMode,
          ingredients: normalizeIngredients(recipe.ingredients),
          steps: recipe.steps,
          prepTime,
          imageUrl // ⭐ EKLENDİ
        };

        const saved = await Recipe.findOneAndUpdate(
          { name: originalMealName, dietMode },
          dbRecipe,
          { upsert: true, new: true }
        );

        finalRecipes.push(saved);
      }
    }
    console.log("rec",finalRecipes)

    return res.json({ recipes: finalRecipes });

  } catch (err) {
    console.log(err);
    return res.status(500).json({ error: "Recipe generation failed" });
  }
});
router.post("/daily-plan", authMiddleware, async (req, res) => {
  
const mealsDailyPath = path.join(process.cwd(), "utils", "daily.json");

const dailyMeals = JSON.parse(fs.readFileSync(mealsDailyPath, "utf-8"));

  try {
    const {
      mood,
      dietMode = "normal",
      language = "en",
    } = req.body;

    // ✅ SADECE BUNLAR ZORUNLU
    if (!mood) {
      return res.status(400).json({ error: "Mood is required" });
    }

    // 🔎 Mood + Diet filter
const matchesMoodDiet = (meal) => {
  // mood zorunlu
  if (!meal.diet.includes(mood)) return false;

  // dietMode opsiyonel
  if (dietMode && !meal.diet.includes(dietMode)) {
    // fallback: normal kabul et
    if (!meal.diet.includes("normal")) return false;
  }

  return true;
};

    const breakfasts = dailyMeals.filter(
      (m) => m.mealTime === "breakfast" && matchesMoodDiet(m)
    );
    const lunches = dailyMeals.filter(
      (m) => m.mealTime === "lunch" && matchesMoodDiet(m)
    );
    const dinners = dailyMeals.filter(
      (m) => m.mealTime === "dinner" && matchesMoodDiet(m)
    );
    const snacks = dailyMeals.filter(
      (m) => m.mealTime === "snacks" && matchesMoodDiet(m)
    );

    const pick = (list) =>
      list.length ? list[Math.floor(Math.random() * list.length)] : null;

    const b = pick(breakfasts);
    const l = pick(lunches);
    const d = pick(dinners);
    const s = pick(snacks);
  console.log("1",s)
    const dayPlan = {
      date: new Date().toISOString(),

      breakfast: language === "en" ? b?.name_en : b?.name_tr,
      lunch: language === "en" ? l?.name_en : l?.name_tr,
      dinner: language === "en" ? d?.name_en : d?.name_tr,
      snacks: language === "en" ? s?.name_en : s?.name_tr,

      breakfast_cal: b?.kcal || 0,
      lunch_cal: l?.kcal || 0,
      dinner_cal: d?.kcal || 0,
      snacks_cal: s?.kcal || 0,

      total_cal:
        (b?.kcal || 0) +
        (l?.kcal || 0) +
        (d?.kcal || 0) +
        (s?.kcal || 0),
    };
    console.log("plan", dayPlan)
    return res.json({
      success: true,
      day: dayPlan,
    });
  } catch (err) {
    console.log("Daily plan error:", err);
    return res.status(500).json({ error: "Daily plan failed" });
  }
});

export const weeklyPlanRoute = router;
