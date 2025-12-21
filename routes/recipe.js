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

function isSameDay(d1, d2) {
  return d1 === d2;
}

// router.post("/recipe"
router.post("/recipe", authMiddleware, async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const user = await User.findById(req.userId);
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const {
    ingredients,
    cuisine,
    language = "en",
    diet,
    mealType = "main",      // main | dessert | snack | soup
    calorieRange,           // { min, max }
  } = req.body;

  /* ===============================
     FREE DAILY LIMIT
  =============================== */
  if (!user.isPremium) {
    if (user.dailyRecipeDate !== today) {
      user.dailyRecipeDate = today;
      user.dailyRecipeCount = 0;
    }

    if (user.dailyRecipeCount >= 3) {
      return res.status(402).json({
        errorCode: "FREE_DAILY_LIMIT_REACHED",
        error:
          language === "en"
            ? "Daily free recipe limit reached."
            : "Günlük ücretsiz tarif hakkınız doldu.",
      });
    }
  }

  /* ===============================
     PROMPT BUILDING
  =============================== */

  const ingredientsText = ingredients
    ? language === "en"
      ? `Ingredients: ${ingredients}`
      : `Malzemeler: ${ingredients}`
    : language === "en"
    ? "Create the recipe freely without specific ingredients."
    : "Belirli bir malzeme olmadan serbest tarif oluştur.";

  const mealTypeTextEN = {
      breakfast: "This is a BREAKFAST recipe. Suitable for morning.",
  lunch: "This is a LUNCH recipe. Balanced and filling.",
  dinner: "This is a DINNER recipe. Suitable for evening meal.",
    dessert: "This is a DESSERT recipe. It must be SWEET.",
    snack: "This is a SNACK recipe. Light and quick.",
    soup: "This is a SOUP recipe.",
    shake: "This is a SHAKE recipe. Drinkable and blended.",
  };

  const mealTypeTextTR = {
      breakfast: "Bu bir KAHVALTI tarifidir. Sabah için uygundur.",
  lunch: "Bu bir ÖĞLE YEMEĞİ tarifidir. Dengeli ve doyurucu olmalıdır.",
  dinner: "Bu bir AKŞAM YEMEĞİ tarifidir.",
    dessert: "Bu bir TATLI tarifidir. Tatlı olmalıdır.",
    snack: "Bu bir ATIŞTIRMALIK tarifidir.",
    soup: "Bu bir ÇORBA tarifidir.",
    shake: "This is a SHAKE recipe. İçilebilir ve blender ile hazırlanır.",
  };

  const cuisineText =
    cuisine && language === "en"
      ? `Recipes should follow ${cuisine} cuisine.`
      : cuisine && language === "tr"
      ? `Tarifler ${cuisine} mutfağına uygun olmalı.`
      : "";

  const calorieTextEN =
    calorieRange?.min && calorieRange?.max
      ? `Total calories(Sum of ingredients calories) MUST be between ${calorieRange.min}-${calorieRange.max} kcal.`
      : "";

  const calorieTextTR =
    calorieRange?.min && calorieRange?.max
      ? `Toplam kalori ${calorieRange.min}-${calorieRange.max} kcal arasında OLMALIDIR. Miktarları ona göre belirle (artır ya da azalt)`
      : "";

  let dietTextEN = "";
  let dietTextTR = "";

  if (diet && diet !== "None") {
    if (diet === "HighProtein") {
      dietTextEN = "Recipes MUST be high-protein and macros optimized accordingly.";
      dietTextTR = "Tarifler ZORUNLU olarak yüksek protein içermeli.";
    } else {
      dietTextEN = `Recipes MUST strictly follow the ${diet} diet.`;
      dietTextTR = `Tarifler ZORUNLU olarak ${diet} diyetine uygun olmalı.`;
    }
  }

  const baseEN = `
${ingredientsText}
${mealTypeTextEN[mealType]}
${cuisineText}
${dietTextEN}
${calorieTextEN}
IMPORTANT:
- Create 2 recipes.
- This recipe MUST serve EXACTLY 1 person.
- servings field MUST be 1.
`;

  const baseTR = `
${ingredientsText}
${mealTypeTextTR[mealType]}
${cuisineText}
${dietTextTR}
${calorieTextTR}ÖNEMLİ:
- 2 tane tarif oluştur.
- Bu tarif ZORUNLU olarak 1 kişilik olmalıdır.
- servings alanı MUTLAKA 1 olmalı.
`;

  const finalPrompt =
    language === "en"
      ? promptEN(baseEN)
      : promptTR(baseTR);

  /* ===============================
     OPENAI CALL
  =============================== */

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: finalPrompt }],
      response_format: { type: "json_object" },
    });

    const data = JSON.parse(completion.choices[0].message.content);

    if (!user.isPremium) {
      user.dailyRecipeCount += 1;
      await user.save();
    }

    return res.json(data);
  } catch (err) {
    console.error("Recipe error:", err);
    return res.status(500).json({
      error: language === "en" ? "OpenAI Error" : "OpenAI hatası",
    });
  }
});


    const promptTR = (base) => `
${base}

Görev:
- 2 adet modern, yaratıcı, şef seviyesinde tarif oluştur.
- Tüm tarifler 1 kişilik olacak.
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
- Hazırlanışı adım adım, BASİT ve DETAYLI yaz:
   • Her adım tek bir işi anlatsın.
   • Kısa ve net cümleler kullan.
   • Teknik terim kullanırsan parantez içinde açıkla (örn: "sote etmek (kısık ateşte çevirerek pişirmek)").
   • Yemek yapmayı bilmeyen biri bile rahatça uygulayabilmeli.
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
     "servings":1,
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
- Create 2 modern, creative, chef-level recipes.
- All recipes MUST serve 1 people.
- Recipe names must be natural, real-world dish names. I use Pexel api for the recipe image, I search the image with that recipe name, so the name must be foundable there.
- Two names are MANDATORY:
   • recipeName_en → English name
   • recipeName_tr → Turkish name
- Avoid artificial names:
   WRONG: "Grilled chicken and vegetables"
   CORRECT: "Vegetable Grilled Chicken"
- Use realistic macros (protein, fat, carbs) and totalCalories.
- Write step-by-step instructions in SIMPLE and DETAILED language:
   • Each step should describe a single clear action.
   • Use short, plain sentences.
   • Avoid cooking jargon; if you must use it, explain it in brackets (e.g. "sauté (cook over medium heat while stirring)").
   • Even someone who has never cooked before must be able to follow and succeed.
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
     "servings":1,
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
// router.post("/recipe-creative"
router.post("/recipe-creative", authMiddleware, async (req, res) => {
  const { language = "en" } = req.body; // 👈 EKLE
  const {
    ingredients,
    cuisine,
    diet,
    isDessert = false,
  } = req.body;

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const recipeTypeEN = isDessert
    ? "Create SWEET dessert recipes."
    : "Create SAVORY main meal recipes.";

  const recipeTypeTR = isDessert
    ? "Tatlı ve şekerli tarifler oluştur."
    : "Tuzlu ana yemek tarifleri oluştur.";

  const baseEN = `
Ingredients: ${ingredients}
${recipeTypeEN}
`;

  const baseTR = `
Malzemeler: ${ingredients}
${recipeTypeTR}
`;

  const finalPrompt =
    language === "en"
      ? promptEN(baseEN)
      : promptTR(baseTR);

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: finalPrompt }],
      response_format: { type: "json_object" },
    });

    const data = JSON.parse(completion.choices[0].message.content);

    // Creative tarifte image yok
    for (let r of data.recipes) {
      r.image = null;
    }

    return res.json(data);
  } catch (err) {
    console.log("Creative recipe error:", err);
    return res.status(500).json({
      error: language === "en" ? "OpenAI Error" : "OpenAI hatası",
    });
  }
});

// promptTR, promptEN, router.post("/recipe-image") ve diğer yardımcı fonksiyonlar aynı kaldı.
// Sadece `/recipe` ve `/recipe-creative` router'ları güncellendi.

export const recipeRoute = router;
