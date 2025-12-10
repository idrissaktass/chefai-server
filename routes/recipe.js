import { Router } from "express";
import OpenAI from "openai";
import { User } from "../models/User.js";
import jwt from "jsonwebtoken";
import axios from "axios";
const router = Router();

const JWT_SECRET =
  "d5f721491a7b51a3c83511efd6457e87729f100ee8f2c3191e4f4384c45f373a2f880ac2fef1fb574d43a4f80e9f4181010b925059da21a0a994e895c01ba0eb";

// AUTH
const authMiddleware = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "Token yok" });

  try {
    const token = header.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.id;
    req.isPremium = decoded.isPremium || false;
    next();
  } catch {
    return res.status(401).json({ error: "Geçersiz token" });
  }
};

router.post("/recipe", authMiddleware, async (req, res) => {
  const { ingredients, dishName, cuisine, language = "tr" } = req.body;

  const user = await User.findById(req.userId);

  const today = new Date().toISOString().slice(0, 10);

  // -------- FREE LIMIT --------
  if (!req.isPremium) {
    if (user.lastRecipeDate !== today) {
      user.lastRecipeDate = today;
      user.dailyRecipeCount = 0;
    }

    if (user.dailyRecipeCount >= 33) {
      return res.status(402).json({
        errorCode: "FREE_DAILY_LIMIT_REACHED",
        error:
          language === "en"
            ? "Your free daily recipe limit is used."
            : "Günlük ücretsiz tarif hakkını kullandın.",
      });
    }

    user.dailyRecipeCount++;
    await user.save();
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    /* =============== PROMPT =============== */

    const cuisineText =
      cuisine && language === "tr"
        ? `Tarifler ${cuisine} mutfağına uygun olsun.\n`
        : cuisine && language === "en"
        ? `Recipes must follow ${cuisine} cuisine.\n`
        : "";

    const baseTR = dishName
      ? `Yemek adı: ${dishName}`
      : `Malzemeler: ${ingredients}`;

    const baseEN = dishName
      ? `Dish name: ${dishName}`
      : `Ingredients: ${ingredients}`;

    const promptTR = `
${baseTR}
${cuisineText}

Görev:
- 3 detaylı tarif oluştur.
- 3 tarif birbirinden farklı olmalı.
- 2 kişilik olacak.
- Her tarifin tüm malzemeleri için:
   • Miktarı gram/ml/adet olarak ZORUNLU yaz.
   • Her malzemenin kalorisini hesapla (kalori alanı ZORUNLU).
   • ingredients içinde şu formatta ver:
       {
         "name": "Tavuk göğsü",
         "amount": "250g",
         "calories": 275
       }
   • ingredientsCalories içinde şu formatta ver:
       {
         "Tavuk göğsü": 275,
         "Zeytinyağı": 120
       }

- Genel gereksinimler:
   • Gerçekçi makrolar (protein, yağ, karbonhidrat)
   • Gerçekçi toplam kalori
   • Hazırlanışı adım adım yaz.
- Her tarif için iki isim ZORUNLU:
   • recipeName_en → İngilizce isim
   • recipeName_tr → Türkçe isim
- Tarif isimleri gerçek hayatta kullanılan doğal yemek isimleri olmalı.
- "X ve Y", "X + Y", "tabağı", "kombinasyonu" gibi yapay ifadeler YASAKTIR.
- Birleşik ve doğal bir yemek adı kullan:
    örn: 
      ❌ "ızgara tavuk göğsü ve sebzeler"
      ✔ "sebzeli ızgara tavuk"
- Her iki isim (recipeName_en ve recipeName_tr) tek bir yemeği temsil etmeli.
- Dünyaca kullanılan, bilinen isimler olmalı.
‼ SADECE JSON DÖNDÜR. Açıklama, metin, markdown YOK. ‼

FORMAT (ZORUNLU):
{
 "recipes":[
   {
    "recipeName_en":"",
     "recipeName_tr":"",
     "prepTime":0,
     "servings":2,
     "ingredients":[
        { "name":"", "amount":"", "calories":0 }
     ],
     "steps":[""],
     "totalCalories":0,
     "totalProtein":0,
     "totalFat":0,
     "totalCarbs":0,
     "ingredientsCalories":{}
   }
 ]
}
`;

    const promptEN = `
${baseEN}
${cuisineText}

Task:
- Generate 3 detailed recipes.
- The recipes must be different from each other.
- MUST serve 2 people.
- For every ingredient:
   • MUST include amount (grams/ml/pieces)
   • MUST include calories
   • MUST use this exact format:
       {
         "name": "Chicken breast",
         "amount": "250g",
         "calories": 275
       }

- ingredientsCalories must be:
{
  "Chicken breast": 275,
  "Olive oil": 120
}

- Include realistic macros + total calories.
- Include step-by-step instructions.
- recipeName_en must be a natural, real-world style dish name.
- Avoid generic or fragmented names:
    ❌ "Grilled chicken and vegetables"
    ✔ "Vegetable Grilled Chicken"
    - The name must be unified as a single concept dish.
- Names must sound like real recipe names used by chefs or restaurants.
‼ RETURN ONLY RAW JSON. NO TEXT, NO MARKDOWN. ‼

FORMAT (MANDATORY):
{
 "recipes":[
   {
     "recipeName_en":"",
     "prepTime":0,
     "servings":2,
     "ingredients":[
        { "name":"", "amount":"", "calories":0 }
     ],
     "steps":[""],
     "totalCalories":0,
     "totalProtein":0,
     "totalFat":0,
     "totalCarbs":0,
     "ingredientsCalories":{}
   }
 ]
}
`;

    const finalPrompt = language === "en" ? promptEN : promptTR;

    /* =============== OPENAI CALL =============== */

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: finalPrompt }],
      response_format: { type: "json_object" }
    });

    const data = JSON.parse(completion.choices[0].message.content);

    return res.json(data);
  } catch (err) {
    console.log("Recipe error:", err);
    res.status(500).json({
      error: language === "en" ? "OpenAI Error" : "OpenAI hatası"
    });
  }
});


    const promptTR = (base) => `
${base}

Görev:
- 3 adet modern, yaratıcı, şef seviyesinde tarif oluştur.
- Tüm tarifler 2 kişilik olacak.
- Tarif isimleri doğal, gerçek hayatta kullanılan yemek isimleri olmalı. Pexels api'de ismi aratacağım, ona uygun, yakın yemek resimleri bulabilmeliyim.
- Her tarifte iki isim ZORUNLU:
   • recipeName_en → İngilizce isim
   • recipeName_tr → Türkçe isim
- "X ve Y", "X + Y", "kombinasyonu", "tabağı" gibi yapay isimler YASAKTIR.
- Tek bir birleşik yemek adı kullan:
   Örn:
     ❌ "ızgara tavuk göğsü ve sebzeler"
     ✔ "sebzeli ızgara tavuk"
- Makrolar (protein, yağ, karbonhidrat) GERÇEKÇİ olmalı.
- totalCalories GERÇEKÇİ olmalı.
- Hazırlanışı adım adım yazılmalı.
- Sunum önerisi ekle (steps içinde olabilir).
- ingredients listesinde:
    • miktar (gram/ml/adet) ZORUNLU
    • calories ZORUNLU
- ingredientsCalories objesi ZORUNLU ve doğru hesaplanmış olmalı.

‼ SADECE JSON döndür. Açıklama, markdown, metin YASAK. ‼

FORMAT (ZORUNLU):
{
 "recipes":[
   {
     "recipeName_en":"",
     "recipeName_tr":"",
     "prepTime":0,
     "servings":2,
     "ingredients":[
       { "name":"", "amount":"", "calories":0 }
     ],
     "steps":[""],
     "totalCalories":0,
     "totalProtein":0,
     "totalFat":0,
     "totalCarbs":0,
     "ingredientsCalories":{}
   }
 ]
}
`;

    const promptEN = (base) => `
${base}

Task:
- Create 3 modern, creative, chef-level recipes.
- All recipes MUST serve 2 people.
- Recipe names must be natural, real-world dish names. I use Pexel api for the recipe image, I search the image with that recipe name, so the name must be foundable there.
- Two names are MANDATORY:
   • recipeName_en → English name
   • recipeName_tr → Turkish name
- Avoid artificial names:
   WRONG: "Grilled chicken and vegetables"
   CORRECT: "Vegetable Grilled Chicken"
- Use realistic macros (protein, fat, carbs) and totalCalories.
- Include step-by-step instructions.
- Add plating suggestions (inside steps is OK).
- For each ingredient:
   • amount (grams/ml/pieces) is REQUIRED
   • calories is REQUIRED
- ingredientsCalories object MUST be correct.

‼ RETURN ONLY PURE JSON. NO TEXT, NO MARKDOWN. ‼

FORMAT (MANDATORY):
{
 "recipes":[
   {
     "recipeName_en":"",
     "recipeName_tr":"",
     "prepTime":0,
     "servings":2,
     "ingredients":[
       { "name":"", "amount":"", "calories":0 }
     ],
     "steps":[""],
     "totalCalories":0,
     "totalProtein":0,
     "totalFat":0,
     "totalCarbs":0,
     "ingredientsCalories":{}
   }
 ]
}
`;

// Basit kelime benzerlik ölçümü
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

router.post("/recipe-image", async (req, res) => {
  const { recipeName } = req.body;

  if (!recipeName) {
    return res.status(400).json({ error: "recipeName missing" });
  }

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

    if (!photo) return res.json({ imageUrl: null });

    // Benzerlik için foto alt text’i ve photographer adı kullanıyoruz
    const checkText =
      `${photo.alt} ${photo.photographer}`.trim();

    const score = similarityScore(recipeName, checkText);

    console.log("EŞLEŞME:", recipeName, "-> skor:", score);

    // ⭐ Eğer benzerlik düşükse resmi gösterme
    if (score < 0.1) {
      console.log("⚠️ Düşük eşleşme → resim reddedildi");
      return res.json({ imageUrl: null });
    }

    return res.json({ imageUrl: photo.src.large });
  } catch (err) {
    console.log("Pexels image error:", err);
    return res.status(500).json({ error: "Image fetch failed" });
  }
});

router.post("/recipe-creative", async (req, res) => {
  const { ingredients, dishName, cuisine, language = "tr" } = req.body;

  try {
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      organization: "org-ndMYkbD4PYCEYyHWmkIxBqpM",
    });

    const baseTR = dishName
      ? `Yemek adı: ${dishName}`
      : `Malzemeler: ${ingredients}`;

    const baseEN = dishName
      ? `Dish name: ${dishName}`
      : `Ingredients: ${ingredients}`;

    const finalPrompt =
      language === "en" ? promptEN(baseEN) : promptTR(baseTR);

    // =========================
    // TARİF ÜRETİMİ (GPT-4o-mini)
    // =========================
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: finalPrompt }],
      response_format: { type: "json_object" },
    });

    const data = JSON.parse(completion.choices[0].message.content);

    // =========================
    // RESİM KALDIRILDI
    // =========================
    for (let recipe of data.recipes) {
      recipe.image = null; // frontend fallback kullanabilir
    }

    return res.json(data);

  } catch (err) {
    console.log("Creative recipe error:", err);
    return res.status(500).json({
      error: language === "en" ? "OpenAI Error" : "OpenAI hatası",
    });
  }
});


export const recipeRoute = router;
