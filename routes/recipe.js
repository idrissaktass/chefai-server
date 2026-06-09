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

const LANG_NAMES = { en: "English", tr: "Turkish", fr: "French", es: "Spanish", de: "German" };

const buildCreativePrompt = (base, language) => {
  const langName = LANG_NAMES[language] || "English";
  return `
⚠️ OUTPUT LANGUAGE: ${langName.toUpperCase()}
ALL text (recipeName, steps, ingredient names) MUST be written in ${langName}. This is mandatory.

${base}

CREATIVITY REQUIREMENTS (VERY IMPORTANT):
- Recipe MUST be truly creative and original, not standard or common dishes.
- Avoid typical home-style or restaurant menu recipes.
- Think like a modern chef creating a signature dish.
- All recipes MUST serve 1 person.
- Avoid artificial compound names like "X and Y" or "X + Y".

TECHNICAL:
- Use realistic macros (protein, fat, carbs) and totalCalories.
- Write steps in ${langName}: DETAILED — include exact temperatures, cooking times, techniques, textures, and tips. Each step 1–3 sentences.
- For each ingredient: amount (grams/ml/pieces) and calories are REQUIRED.
- ingredientsCalories object MUST be correct.

‼ RETURN ONLY PURE JSON. NO TEXT, NO MARKDOWN. ‼

FORMAT:
{
 "recipes": {
   "recipeName": "",
   "prepTime": 0,
   "servings": 1,
   "ingredients": [{ "name": "", "amount": "", "calories": 0 }],
   "steps": [""],
   "totalCalories": 0,
   "totalProtein": 0,
   "totalFat": 0,
   "totalCarbs": 0,
   "ingredientsCalories": {}
 }
}
`;
};

const buildRecipePrompt = (base, language) => {
  const langName = LANG_NAMES[language] || "English";
  return `
⚠️ OUTPUT LANGUAGE: ${langName.toUpperCase()}
ALL text (recipeName, steps, ingredient names) MUST be written in ${langName}. This is mandatory.
basicName → always in English (used for stock photo search only).

${base}

TASK:
- Create 2 modern and delicious recipes for 1 person.

NAMING:
- recipeName → in ${langName} (the user's language)
- basicName → most basic globally known name for stock photo search (always in English, 1–3 words)

TECHNICAL:
- Write ALL steps in ${langName}: include exact temperatures (°C/°F), cooking times, techniques, textures, and tips per step. Each step 1–3 sentences.
- Write ALL ingredient names in ${langName}.
- Macros and totalCalories must be realistic based on ingredients.
- ingredients: amount + calories required.

‼ RETURN ONLY PURE JSON. NO TEXT, NO MARKDOWN. ‼

FORMAT:
{
 "recipes": [
   {
     "basicName": "",
     "recipeName": "",
     "prepTime": 20,
     "servings": 1,
     "ingredients": [{ "name": "", "amount": "", "calories": 0 }],
     "steps": ["Step 1...", "Step 2..."],
     "totalCalories": 0,
     "totalProtein": 0,
     "totalFat": 0,
     "totalCarbs": 0,
     "ingredientsCalories": {}
   }
 ]
}
`;
};

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
  baseIdeaText = `The user wants this specific dish: ${dishName}. Create recipes that clearly match this dish. Adapt according to diet type and cuisine.`;
} else if (ingredients) {
  baseIdeaText = `Ingredients: ${ingredients}`;
} else {
  baseIdeaText = "Create the recipe freely.";
}

const quickTextMap = {
  movie_night:       "Create fun, easy, finger-food style recipes perfect for a movie night. Snack-like, shareable, indulgent.",
  date_night:        "Create elegant, romantic, visually appealing dinner recipes suitable for a date night.",
  gym_meal:          "Create high-protein, fitness-oriented meals suitable for gym lifestyle.",
  comfort_food:      "Create comforting, warm, emotionally satisfying comfort food recipes.",
  late_night:        "Create light but satisfying late night snack recipes.",
  healthy_breakfast: "Create healthy, energizing breakfast recipes.",
  world_flavors:     "Create recipes inspired by different world cuisines.",
  chef_special:      "Create visually impressive chef-style signature dishes.",
  meal_prep:         "Create meal prep friendly recipes suitable for batch cooking.",
  kid_friendly:      "Create fun, colorful, kid-friendly recipes.",
  spicy_food:        "Create bold, spicy, flavor-packed recipes.",
  low_cal:           "Create low calorie, light but tasty recipes.",
  sweet_craving:     "Create sweet, indulgent dessert-style recipes. Focus on sugar cravings, chocolate, fruits, or baked treats.",
  quick_meal:        "Create very fast recipes that can be prepared in 10 minutes or less. Simple steps, minimal ingredients.",
  surprise:          "Surprise the user with unexpected, fun, creative, and varied recipes. Do not stick to a single cuisine or style.",
};
const quickText = quickTextMap[quickType] || "";


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

  const cuisineText = cuisine ? `Recipes should follow ${cuisine} cuisine.` : "";

  const calorieText =
    calorieRange?.min && calorieRange?.max
      ? `Total calories MUST be between ${calorieRange.min}-${calorieRange.max} kcal.`
      : "";

  let dietText = "";
  if (diet && diet !== "None") {
    dietText = diet === "HighProtein"
      ? "Recipes MUST be high-protein and macros optimized accordingly."
      : `Recipes MUST strictly follow the ${diet} diet.`;
  }

  const allergyList = Array.isArray(allergies)
    ? allergies.filter(Boolean).join(", ")
    : (typeof allergies === "string" ? allergies.trim() : "");

  const allergyText = allergyList
    ? `STRICT ALLERGY/EXCLUSION: The recipe MUST NOT contain any of the following ingredients or their derivatives: ${allergyList}. This is a safety requirement.`
    : "";

  const base = `
${quickText}
${baseIdeaText}
${mealTypeTextEN[mealType]}
${cuisineText}
${dietText}
${allergyText}
${calorieText}
IMPORTANT:
- 
- 2 recipes in ${language}.
- MUST serve 1 person
- servings must be 1
- basicName must be perfect for stock food photos
`;

const finalPrompt = buildRecipePrompt(base, language);

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
  const { quickType, language = "en" } = req.body;
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const quickTextMap = {
    movie_night:       "Create fun, easy, finger-food style recipes perfect for a movie night. Snack-like, shareable, indulgent.",
    date_night:        "Create elegant, romantic, visually appealing dinner recipes suitable for a date night.",
    gym_meal:          "Create high-protein, fitness-oriented meals suitable for gym lifestyle.",
    comfort_food:      "Create comforting, warm, emotionally satisfying comfort food recipes.",
    late_night:        "Create light but satisfying late night snack recipes.",
    healthy_breakfast: "Create healthy, energizing breakfast recipes.",
    world_flavors:     "Create recipes inspired by different world cuisines.",
    chef_special:      "Create visually impressive chef-style signature dishes.",
    meal_prep:         "Create meal prep friendly recipes suitable for batch cooking.",
    kid_friendly:      "Create fun, colorful, kid-friendly recipes.",
    spicy_food:        "Create bold, spicy, flavor-packed recipes.",
    low_cal:           "Create low calorie, light but tasty recipes.",
    sweet_craving:     "Create sweet, indulgent dessert-style recipes. Focus on sugar cravings, chocolate, fruits, or baked treats.",
    quick_meal:        "Create very fast recipes that can be prepared in 10 minutes or less. Simple steps, minimal ingredients.",
    surprise:          "Surprise the user with unexpected, fun, creative, and varied recipes. Do not stick to a single cuisine or style.",
    vegan:             "Create 100% vegan recipes with no animal products.",
  };

  const base = `
${quickTextMap[quickType] || "Create 2 delicious recipes for 1 person."}
IMPORTANT:
- 2 recipes for 1 person
- servings must be 1
- basicName must be perfect for stock food photos (always in English, 1-3 words)
`;

  const finalPrompt = buildRecipePrompt(base, language);

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: finalPrompt }],
      response_format: { type: "json_object" },
    });

    const data = JSON.parse(completion.choices[0].message.content);
    return res.json(data);
  } catch (err) {
    console.error("Quick recipe AI error:", err);
    return res.status(500).json({ error: "Quick recipe generation failed" });
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



// router.post("/recipe-creative"
router.post("/recipe-creative", authMiddleware, async (req, res) => {
  const { language = "en", ingredients, cuisine, diet, mealType, dishName, allergies } = req.body;

  const creativeAllergyList = Array.isArray(allergies)
    ? allergies.filter(Boolean).join(", ")
    : (typeof allergies === "string" ? allergies.trim() : "");

  const creativeAllergyText = creativeAllergyList
    ? `STRICT ALLERGY/EXCLUSION: The recipe MUST NOT contain any of the following ingredients or their derivatives: ${creativeAllergyList}. This is a safety requirement.`
    : "";

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const creativeTypeText = mealType ? `This creative recipe MUST strictly follow this style: ${mealType}.` : "";
  const creativeCuisineText = cuisine ? `Recipe MUST follow ${cuisine} cuisine.` : "";

  let creativeDietText = "";
  if (diet && diet !== "None") {
    creativeDietText = diet === "HighProtein"
      ? "Recipe MUST be high-protein and macros optimized accordingly."
      : `Recipe MUST strictly follow the ${diet} diet.`;
  }

  let baseIdea = "";
  if (dishName) {
    baseIdea = `The user specifically wants this dish: "${dishName}". Create creative chef-level versions. The core identity of the dish must be clearly recognizable. Adapt according to diet type and cuisine.`;
  } else if (ingredients) {
    baseIdea = `Ingredients: ${ingredients}`;
  } else {
    baseIdea = "Create a free creative chef-level recipe.";
  }

  const base = `
${baseIdea}
${creativeTypeText}
${creativeCuisineText}
${creativeDietText}
${creativeAllergyText}

IMPORTANT:
- Create 1 creative chef-level recipe.
- All recipes MUST serve EXACTLY 1 person.
- servings field MUST always be 1.
- If a dish name is given, the result MUST clearly match that dish.
- Each creative recipe must feel "Instagrammable" and visually striking.
`;

  const finalPrompt = buildCreativePrompt(base, language);

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

export const recipeRoute = router;
