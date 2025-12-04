import { Router } from "express";
import OpenAI from "openai";
import { User } from "../models/User.js";
import jwt from "jsonwebtoken";

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

‼ SADECE JSON DÖNDÜR. Açıklama, metin, markdown YOK. ‼

FORMAT (ZORUNLU):
{
 "recipes":[
   {
     "recipeName":"",
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

‼ RETURN ONLY RAW JSON. NO TEXT, NO MARKDOWN. ‼

FORMAT (MANDATORY):
{
 "recipes":[
   {
     "recipeName":"",
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


router.post("/recipe-creative", authMiddleware, async (req, res) => {
  if (!req.isPremium) {
    return res.status(402).json({
      error: "PREMIUM_REQUIRED"
    });
  }

  const { ingredients, dishName, cuisine, language = "tr" } = req.body;

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const baseTR = dishName
      ? `Yemek adı: ${dishName}`
      : `Malzemeler: ${ingredients}`;

    const baseEN = dishName
      ? `Dish name: ${dishName}`
      : `Ingredients: ${ingredients}`;

    const promptTR = `
${baseTR}

Görev:
- 3 tane modern, yaratıcı, şef seviyesinde tarif oluştur
- 2 kişilik olsun
- sunum önerisi ekle
- aromalar, baharatlar ve dokular uyumlu olsun
- mecburi yan ürünler: pilav, yoğurt, salata veya meze alternatifleri
- sadece JSON döndür
`;

    const promptEN = `
${baseEN}

Task:
- Create 3 modern, creative, chef-level recipes
- All recipes must serve 2 people
- Add plating suggestions
- Use balanced flavors, spices, textures
- Required sides: rice, yogurt, salad, or mezze alternatives
- Return ONLY JSON
`;

    const finalPrompt = language === "en" ? promptEN : promptTR;

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: finalPrompt }],
      response_format: { type: "json_object" }
    });

    const data = JSON.parse(completion.choices[0].message.content);

    return res.json(data);
  } catch (err) {
    console.log("Creative recipe error:", err);
    res.status(500).json({
      error: language === "en" ? "OpenAI Error" : "OpenAI hatası"
    });
  }
});
router.get("/recipe/test", (req, res) => {
  res.json({ ok: true, message: "Auth route çalışıyor" });
});

export const recipeRoute = router;
