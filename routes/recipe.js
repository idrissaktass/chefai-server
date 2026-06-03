import { Router } from "express";
import OpenAI from "openai";
import { User } from "../models/User.js";
import jwt from "jsonwebtoken";
import axios from "axios";
import fs from "fs";
import path from "path";

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

const recipePromptTR = (base) => `
${base}

GÖREV:
- 2 adet modern ve iştah açıcı tarif oluştur.
- Her tarif 1 kişiliktir.

İSİMLENDİRME:
- recipeName_tr → Kullanıcıya gösterilecek doğal isim
- recipeName_en → Global yemek ismi
- basicName → En basit, en genel, herkesin bildiği isim (görsel arama için)

Örnek:
 recipeName_tr: "Ballı Soslu Izgara Tavuk"
 recipeName_en: "Honey Glazed Grilled Chicken"
 basicName: "Grilled Chicken"

KURALLAR:
- basicName 1–3 kelime olmalı.
- Süsleme, hayali isim, nadir yemek basicName olamaz.

TEKNİK:
- steps kısa, net, numaralı.
- ingredients: miktar + kalori zorunlu.
- Makrolar ve totalCalories GERÇEKÇİ olmalı.

‼ SADECE JSON DÖNDÜR ‼

FORMAT:
{
 "recipes":[
   {
     "basicName": "",
     "recipeName_en": "",
     "recipeName_tr": "",
     "prepTime": 20,
     "servings": 1,
     "ingredients": [{ "name": "", "amount": "", "calories": 0 }],
     "steps": ["Adım 1...", "Adım 2..."],
     "totalCalories": 0,
     "totalProtein": 0,
     "totalFat": 0,
     "totalCarbs": 0,
     "ingredientsCalories": {}
   }
 ]
}
`;

const recipePromptEN = (base) => `
${base}

TASK:
- Create 1 modern and delicious recipes for 1 person.

NAMING:
- recipeName_en → The simple global name.
- recipeName_tr → Turkish translation
- basicName → MOST BASIC globally known name for stock photo search

- Example:
   recipeName_en: "Honey Glazed Grilled Chicken"
   basicName: "Grilled Chicken"

Rules for basicName:
- 1–3 simple words
- globally known
- perfect for stock photo search

TECHNICAL:
- Write step-by-step instructions in SIMPLE and DETAILED language:
   • Each step should describe a single clear action.
   • Use short, plain sentences.
   • Avoid cooking jargon; if you must use it, explain it in brackets (e.g. "sauté (cook over medium heat while stirring)").
   • Even someone who has never cooked before must be able to follow and succeed.
- Macros and totalCalories must be realistic based on ingredients.

‼ RETURN ONLY PURE JSON. NO TEXT, NO MARKDOWN. ‼

FORMAT:
{
 "recipes":
   {
    "basicName": "Grilled Chicken",
     "recipeName_en": "Simple Iconic Name",
     "recipeName_tr": "Natural Turkish Name",
     "prepTime": 20,
     "servings": 1,
     "ingredients": [{ "name": "Chicken", "amount": "150g", "calories": 250 }],
     "steps": ["Step 1...", "Step 2..."],
     "totalCalories": 0,
     "totalProtein": 0,
     "totalFat": 0,
     "totalCarbs": 0
     "ingredientsCalories": {}
   }
}
`;

// router.post("/recipe"
router.post("/recipe", authMiddleware, async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const user = await User.findById(req.userId);
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const {
    ingredients,
    dishName,
    cuisine,
    language = "en",
    diet,
    quickType,
    mealType = "main",      // main | dessert | snack | soup
    calorieRange,           // { min, max }
    allergies,              // string[] | string → hariç tutulacak malzemeler
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

let baseIdeaText = "";

if (dishName) {
  baseIdeaText = language === "en"
    ? `The user wants this specific dish: ${dishName}. Create recipes that clearly match this dish. Adapt according to diet type and cuisine.`
    : `Kullanıcı özellikle şu yemeği istiyor: ${dishName}. Tarifler bu yemeğe net şekilde uymalıdır.`;
} else if (ingredients) {
  baseIdeaText = language === "en"
    ? `Ingredients: ${ingredients}`
    : `Malzemeler: ${ingredients}`;
} else {
  baseIdeaText = language === "en"
    ? "Create the recipe freely."
    : "Serbest tarif oluştur.";
}
let quickTextEN = "";
let quickTextTR = "";

if (quickType === "movie_night") {
  quickTextEN = "Create fun, easy, finger-food style recipes perfect for a movie night. Snack-like, shareable, indulgent.";
  quickTextTR = "Film gecesi için eğlenceli, elde yenebilen, atıştırmalık tarzı tarifler oluştur.";
}

if (quickType === "date_night") {
  quickTextEN = "Create elegant, romantic, visually appealing dinner recipes suitable for a date night.";
  quickTextTR = "Date night için şık, romantik, sunumu güzel akşam yemeği tarifleri oluştur.";
}

if (quickType === "gym_meal") {
  quickTextEN = "Create high-protein, fitness-oriented meals suitable for gym lifestyle.";
  quickTextTR = "Spor yapanlar için yüksek proteinli tarifler oluştur.";
}
if (quickType === "comfort_food") {
  quickTextEN = "Create comforting, warm, emotionally satisfying comfort food recipes.";
  quickTextTR = "Rahatlatıcı, doyurucu, insanı iyi hissettiren comfort food tarifleri oluştur.";
}

if (quickType === "late_night") {
  quickTextEN = "Create light but satisfying late night snack recipes.";
  quickTextTR = "Gece için hafif ama tatmin edici atıştırmalık tarifler oluştur.";
}

if (quickType === "healthy_breakfast") {
  quickTextEN = "Create healthy, energizing breakfast recipes.";
  quickTextTR = "Sağlıklı, enerji veren kahvaltı tarifleri oluştur.";
}

if (quickType === "world_flavors") {
  quickTextEN = "Create recipes inspired by different world cuisines.";
  quickTextTR = "Dünya mutfaklarından ilham alan tarifler oluştur.";
}

if (quickType === "chef_special") {
  quickTextEN = "Create visually impressive chef-style signature dishes.";
  quickTextTR = "Şef tarzı, sunumu etkileyici imza yemekler oluştur.";
}

if (quickType === "meal_prep") {
  quickTextEN = "Create meal prep friendly recipes suitable for batch cooking.";
  quickTextTR = "Önceden hazırlanıp saklanabilecek meal-prep tarifleri oluştur.";
}

if (quickType === "kid_friendly") {
  quickTextEN = "Create fun, colorful, kid-friendly recipes.";
  quickTextTR = "Çocuklara uygun, eğlenceli tarifler oluştur.";
}

if (quickType === "spicy_food") {
  quickTextEN = "Create bold, spicy, flavor-packed recipes.";
  quickTextTR = "Acılı, aroması güçlü tarifler oluştur.";
}

if (quickType === "low_cal") {
  quickTextEN = "Create low calorie, light but tasty recipes.";
  quickTextTR = "Düşük kalorili, hafif ama lezzetli tarifler oluştur.";
}
if (quickType === "sweet_craving") {
  quickTextEN = "Create sweet, indulgent dessert-style recipes. Focus on sugar cravings, chocolate, fruits, or baked treats.";
  quickTextTR = "Tatlı isteğine yönelik, tatlı ve keyif veren tarifler oluştur. Çikolata, meyve veya fırın tatlıları olabilir.";
}
if (quickType === "quick_meal") {
  quickTextEN = "Create very fast recipes that can be prepared in 10 minutes or less. Simple steps, minimal ingredients.";
  quickTextTR = "10 dakikada hazırlanabilecek, çok pratik ve az malzemeli tarifler oluştur.";
}
if (quickType === "surprise") {
  quickTextEN = "Surprise the user with unexpected, fun, creative, and varied recipes. Do not stick to a single cuisine or style.";
  quickTextTR = "Kullanıcıyı şaşırtacak, eğlenceli, yaratıcı ve farklı tarzlarda tarifler oluştur. Tek bir mutfağa bağlı kalma.";
}


const mealTypeTextEN = {
  breakfast: "This is a BREAKFAST recipe. Suitable for morning.",
  lunch: "This is a LUNCH recipe. Balanced and filling.",
  dinner: "This is a DINNER recipe. Suitable for evening meal.",
  dessert: "This is a DESSERT recipe. It must be SWEET.",
  snack: "This is a SNACK recipe. Light and quick.",
  soup: "This is a SOUP recipe.",
  shake: "This is a SHAKE recipe. Drinkable and blended.",

  // 🔥 NEW
  sandwich: "This is a SANDWICH recipe. Must be handheld and layered.",
  pizza: "This is a PIZZA recipe. Must include dough/base, sauce and toppings.",
  burger: "This is a BURGER recipe. Must include bun, patty and sauce.",
  wrap: "This is a WRAP recipe. Rolled and easy to eat.",
  fastfood: "This is a FAST FOOD style recipe. Quick, indulgent and street-style.",
  salad: "This is a SALAD recipe. Fresh, light and mostly cold.",
  pasta: "This is a PASTA recipe. Italian-style noodle based dish.",
  chicken: "This is a CHICKEN-based main dish.",
  seafood: "This is a SEAFOOD recipe. Based on fish or seafood.",
  streetfood: "This is a STREET FOOD recipe. Practical, handheld, bold flavors.",
  bakery: "This is a BAKERY style recipe. Dough-based, oven baked."
};

const mealTypeTextTR = {
  breakfast: "Bu bir KAHVALTI tarifidir. Sabah için uygundur.",
  lunch: "Bu bir ÖĞLE YEMEĞİ tarifidir. Dengeli ve doyurucu olmalıdır.",
  dinner: "Bu bir AKŞAM YEMEĞİ tarifidir.",
  dessert: "Bu bir TATLI tarifidir. Tatlı olmalıdır.",
  snack: "Bu bir ATIŞTIRMALIK tarifidir.",
  soup: "Bu bir ÇORBA tarifidir.",
  shake: "Bu bir SHAKE tarifidir. İçilebilir ve blender ile hazırlanır.",

  // 🔥 NEW
  sandwich: "Bu bir SANDVİÇ tarifidir. Elde yenebilir ve katmanlı olmalıdır.",
  pizza: "Bu bir PİZZA tarifidir. Hamur, sos ve üst malzemeler içermelidir.",
  burger: "Bu bir BURGER tarifidir. Ekmek, köfte ve sos içermelidir.",
  wrap: "Bu bir DÜRÜM/WRAP tarifidir. Sarılarak hazırlanmalıdır.",
  fastfood: "Bu bir FAST FOOD tarzı tariftir. Pratik, sokak lezzeti stilinde olmalıdır.",
  salad: "Bu bir SALATA tarifidir. Hafif, ferah ve çoğunlukla soğuk olmalıdır.",
  pasta: "Bu bir MAKARNA tarifidir. İtalyan tarzı olmalıdır.",
  chicken: "Bu bir TAVUK bazlı ana yemektir.",
  seafood: "Bu bir DENİZ ÜRÜNLERİ tarifidir.",
  streetfood: "Bu bir SOKAK LEZZETİ tarifidir. Pratik ve elde yenebilir olmalıdır.",
  bakery: "Bu bir FIRIN / HAMUR İŞİ tarifidir. Fırında pişirilmelidir."
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

  // 🚫 ALERJI / HARİÇ TUTMA
  const allergyList = Array.isArray(allergies)
    ? allergies.filter(Boolean).join(", ")
    : (typeof allergies === "string" ? allergies.trim() : "");

  const allergyTextEN = allergyList
    ? `STRICT ALLERGY/EXCLUSION: The recipe MUST NOT contain any of the following ingredients or their derivatives: ${allergyList}. This is a safety requirement.`
    : "";
  const allergyTextTR = allergyList
    ? `ZORUNLU ALERJI/HARİÇ TUTMA: Tarif şu malzemeleri ve türevlerini KESİNLİKLE içermemelidir: ${allergyList}. Bu bir güvenlik kuralıdır.`
    : "";

  const baseEN = `
${quickTextEN}
${baseIdeaText}
${mealTypeTextEN[mealType]}
${cuisineText}
${dietTextEN}
${allergyTextEN}
${calorieTextEN}
IMPORTANT:
- 2 recipes
- MUST serve 1 person
- servings must be 1
- basicName must be perfect for stock food photos
`;

  const baseTR = `
${baseIdeaText}
${mealTypeTextTR[mealType]}
${cuisineText}
${dietTextTR}
${allergyTextTR}
${calorieTextTR}ÖNEMLİ:
- 2 tane tarif oluştur.
- Bu tarif ZORUNLU olarak 1 kişilik olmalıdır.
- servings alanı MUTLAKA 1 olmalı.
`;

const finalPrompt =
  language === "en"
    ? recipePromptEN(baseEN) // Yeni fonksiyon
    : recipePromptTR(baseTR);

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
    console.log("xd",data)

    return res.json(data);
  } catch (err) {
    console.error("Recipe error:", err);
    return res.status(500).json({
      error: language === "en" ? "OpenAI Error" : "OpenAI hatası",
    });
  }
});

router.post("/quick-recipe", authMiddleware, async (req, res) => {
  try {
    const { quickType, language = "en" } = req.body;

    const filePath = path.join(process.cwd(), "utils", "quick.json");
    const raw = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw);

    let recipes = data.recipes;

    // type filtresi
    if (quickType) {
      recipes = recipes.filter(r => r.type === quickType);
    }

    // random 2 tane seç
    recipes = recipes.sort(() => 0.5 - Math.random()).slice(0, 2);

    return res.json({ recipes });

  } catch (err) {
    console.log("quick json error:", err);
    return res.status(500).json({ error: "Quick recipe load failed" });
  }
});


router.post("/recipe-image", async (req, res) => {
  const { recipeName } = req.body;

  if (!recipeName) {
    return res.status(400).json({ error: "recipeName missing" });
  }

  try {
    const PIXABAY_KEY = "54233466-13c9ed6a59b17c998d642b0aa";

    const response = await axios.get(
      "https://pixabay.com/api/",
      {
        params: {
          key: PIXABAY_KEY,
          q: recipeName + " food",
          image_type: "photo",
          category: "food",
          safesearch: true,
          per_page: 5,
        },
      }
    );

    const hits = response.data?.hits || [];

    if (!hits.length) return res.json({ imageUrl: null });

    // ⭐ en yüksek çözünürlüklü olanı al
    const best = hits[0];

    return res.json({
      imageUrl: best.largeImageURL || best.webformatURL
    });

  } catch (err) {
    console.log("Pixabay image error:", err);
    return res.status(500).json({ error: "Image fetch failed" });
  }
});


    const promptTR = (base) => `
${base}

Görev:
- 2 adet modern, yaratıcı, şef seviyesinde tarif oluştur.
- Tüm tarifler 1 kişilik olacak.
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
CREATIVITY REQUIREMENTS (VERY IMPORTANT):
- Recipe MUST be truly creative and original, not standard or common dishes.
- Avoid typical home-style or restaurant menu recipes.
- Recipe should include at least one unexpected flavor combination, technique, or presentation idea.
- Think like a modern chef creating a signature dish.
- The result should feel unique, experimental, and inspiring.
- All recipes MUST serve 1 people.
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
 "recipes":
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
}
`;

// router.post("/recipe-creative"
router.post("/recipe-creative", authMiddleware, async (req, res) => {
  const { language = "en" } = req.body; // 👈 EKLE
const { ingredients, cuisine, diet, mealType, dishName, allergies } = req.body;

const creativeAllergyList = Array.isArray(allergies)
  ? allergies.filter(Boolean).join(", ")
  : (typeof allergies === "string" ? allergies.trim() : "");

const allergyTextEN = creativeAllergyList
  ? `STRICT ALLERGY/EXCLUSION: The recipe MUST NOT contain any of the following ingredients or their derivatives: ${creativeAllergyList}. This is a safety requirement.`
  : "";
const allergyTextTR = creativeAllergyList
  ? `ZORUNLU ALERJI/HARİÇ TUTMA: Tarif şu malzemeleri ve türevlerini KESİNLİKLE içermemelidir: ${creativeAllergyList}. Bu bir güvenlik kuralıdır.`
  : "";

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const creativeTypeEN = mealType
  ? `This creative recipe MUST strictly follow this style: ${mealType}.`
  : "";

const creativeTypeTR = mealType
  ? `Bu yaratıcı tarif ZORUNLU olarak şu türe uymalıdır: ${mealType}.`
  : "";

const cuisineTextEN = cuisine
  ? `Recipe MUST follow ${cuisine} cuisine.`
  : "";

const cuisineTextTR = cuisine
  ? `Tarifler ZORUNLU olarak ${cuisine} mutfağına uygun olmalıdır.`
  : "";

let dietTextEN = "";
let dietTextTR = "";

if (diet && diet !== "None") {
  if (diet === "HighProtein") {
    dietTextEN = "Recipe MUST be high-protein and macros optimized accordingly.";
    dietTextTR = "Tarifler ZORUNLU olarak yüksek proteinli olmalıdır.";
  } else {
    dietTextEN = `Recipe MUST strictly follow the ${diet} diet.`;
    dietTextTR = `Tarifler ZORUNLU olarak ${diet} diyetine uygun olmalıdır.`;
  }
}
  let baseIdeaEN = "";
  let baseIdeaTR = "";

  if (dishName) {
    baseIdeaEN = `The user specifically wants this dish: "${dishName}". Create creative chef-level versions of this dish. The core identity of the dish must be clearly recognizable.Adapt according to diet type and cuisine.`;
    baseIdeaTR = `Kullanıcı özellikle şu yemeği istiyor: "${dishName}". Bu yemeğin yaratıcı, şef seviyesinde versiyonlarını oluştur. Yemeğin ana kimliği NET şekilde korunmalı.`;
  } else if (ingredients) {
    baseIdeaEN = `Ingredients: ${ingredients}`;
    baseIdeaTR = `Malzemeler: ${ingredients}`;
  } else {
    baseIdeaEN = "Create free creative chef-level recipe.";
    baseIdeaTR = "Serbest yaratıcı, şef seviyesinde tarifler oluştur.";
  }
const baseEN = `
${baseIdeaEN}
${creativeTypeEN}
${cuisineTextEN}
${dietTextEN}
${allergyTextEN}

IMPORTANT:
- Create 1 creative chef-level recipes.
- All recipes MUST serve EXACTLY 1 person.
- servings field MUST always be 1.
- If a dish name is given, the result MUST clearly match that dish.
Each creative recipe must feel "Instagrammable" and visually striking.
`;

const baseTR = `
Malzemeler: ${ingredients || "Serbest yaratıcı tarif oluştur."}
${creativeTypeTR}
${cuisineTextTR}
${dietTextTR}
${allergyTextTR}

ÖNEMLİ:
- 1 adet yaratıcı, şef seviyesinde tarif oluştur.
- Tüm tarifler ZORUNLU olarak 1 kişilik olmalıdır.
- servings alanı her zaman 1 olmalı.
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

    // ✅ HER DURUMDA ARRAY'E ÇEVİR
    if (data.recipes && !Array.isArray(data.recipes)) {
      data.recipes = [data.recipes];
    }
    
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
