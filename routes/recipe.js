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

/* ===================== NORMAL TARİF ===================== */
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
        error: language === "en"
          ? "Your free daily recipe limit is used."
          : "Günlük ücretsiz tarif hakkını kullandın.",
        errorCode: "FREE_DAILY_LIMIT_REACHED"
      });
    }

    user.dailyRecipeCount++;
    await user.save();
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    /* =============== DİL DESTEKLİ PROMPT =============== */

    const cuisineText =
      cuisine && language === "tr"
        ? `Tarifler ${cuisine} mutfağına uygun olsun.\n`
        : cuisine && language === "en"
        ? `Recipes must follow ${cuisine} cuisine.\n`
        : "";

    // Kullanıcı girişi
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
- 3 detaylı tarif oluştur
- Türk damak tadına uygun cümle yapısı kullan
- Her tarif:
  • 2 kişilik olsun ve malzemelerin miktarını 2 kişiye uygun olarak belirt.
  • gerçekçi makro (protein, yağ, karbonhidrat) ve kalori hesapla
  • hazırlanışı adım adım yaz
  • yemek adını açık yaz
- Sadece JSON döndür. Açıklama yazma.

Format:
{
 "recipes":[
   {
     "recipeName":"",
     "prepTime":0,
     "servings":2,
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
- Generate 3 detailed recipes
- Use natural English phrasing
- Each recipe must:
  • serve 2 people, specify and clearly state the amount of ingredients suitable for 2 people
  • include realistic macros (protein, fat, carbs) & total calories
  • include step-by-step preparation instructions
  • clearly state the recipe name
- Return ONLY raw JSON. No explanations.

Format:
{
 "recipes":[
   {
     "recipeName":"",
     "prepTime":0,
     "servings":2,
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
    console.log(err);
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
router.get("/test", (req, res) => {
  res.json({ ok: true, message: "Auth route çalışıyor" });
});

export const recipeRoute = router;
