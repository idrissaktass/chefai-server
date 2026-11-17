import { Router } from "express";
import OpenAI from "openai";
import { RecipeOfTheDay } from "../models/RecipeOfTheDay.js";
import { searchFoodImage } from "./recipe.js";

const router = Router();

const LANGS = ["tr", "en", "de", "fr", "es"];

// Her gün farklı bir tema — tarih sırasına göre döner
const THEMES = [
  "Turkish home cooking classic",
  "Italian pasta or risotto",
  "Japanese or Korean inspired bowl",
  "Mediterranean seafood dish",
  "Mexican or Latin American dish",
  "hearty vegetarian main course",
  "Indian or Middle Eastern curry or stew",
  "healthy high-protein chicken dish",
  "French bistro classic",
  "colorful main-course salad",
  "Thai or Vietnamese dish",
  "comforting soup with bread",
  "homemade dessert or baked treat",
  "weekend brunch dish",
];

const isValidDate = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);

// Kullanıcının yerel tarihini kabul et ama sunucu tarihinden en fazla 1 gün sapabilir
function resolveDate(requested) {
  const now = Date.now();
  const serverDate = new Date(now).toISOString().split("T")[0];
  if (!isValidDate(requested)) return serverDate;
  const diff = Math.abs(new Date(requested + "T12:00:00Z").getTime() - now);
  return diff <= 36 * 60 * 60 * 1000 ? requested : serverDate;
}

function themeFor(date) {
  const dayNumber = Math.floor(new Date(date + "T00:00:00Z").getTime() / 86400000);
  return THEMES[dayNumber % THEMES.length];
}

async function generateRecipe(date) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const theme = themeFor(date);

  // Son 30 günün tariflerini tekrar etme
  const recent = await RecipeOfTheDay.find().sort({ date: -1 }).limit(30).select("basicName");
  const avoid = recent.map((r) => r.basicName).filter(Boolean);
  const avoidClause = avoid.length ? `Do NOT suggest any of these (recently used): ${avoid.join(", ")}.` : "";

  const prompt = `
You are a chef picking the "Recipe of the Day" for a cooking app.

Theme for today: ${theme}.
${avoidClause}

RULES:
- One real, well-known or appealing dish that a home cook can make. Serves 1 person.
- Realistic macros and totalCalories, based on the ingredients.
- Each ingredient needs amount (grams/ml/pieces) and calories.
- 4–8 steps, each 1–2 sentences with temperatures and times where relevant.
- description: one appetizing sentence (max 110 chars).
- basicName: the simplest globally known English name of the dish (1–3 words), used for stock photo search.
- Provide the SAME recipe translated into tr (Turkish), en (English), de (German), fr (French), es (Spanish).
  Ingredient lists must have the same order and calories in every language.

RETURN ONLY JSON:
{
  "basicName": "",
  "prepTime": 25,
  "servings": 1,
  "totalCalories": 0,
  "totalProtein": 0,
  "totalFat": 0,
  "totalCarbs": 0,
  "tr": { "recipeName": "", "description": "", "ingredients": [{ "name": "", "amount": "", "calories": 0 }], "steps": [""] },
  "en": { ... }, "de": { ... }, "fr": { ... }, "es": { ... }
}
`;

  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
  });

  const data = JSON.parse(completion.choices[0].message.content);
  if (!data.basicName || LANGS.some((l) => !data[l]?.recipeName)) {
    throw new Error("Incomplete recipe of the day response");
  }

  let image = null;
  try {
    image = await searchFoodImage(data.basicName);
  } catch (err) {
    console.log("Recipe of the day image error:", err.message);
  }

  const doc = { date, theme, image, ...data };
  try {
    return await RecipeOfTheDay.create(doc);
  } catch (err) {
    // Başka bir istek aynı günü önce kaydettiyse onu kullan
    if (err.code === 11000) return RecipeOfTheDay.findOne({ date });
    throw err;
  }
}

// Aynı gün için eşzamanlı istekler tek üretimi beklesin
const pending = new Map();

async function getOrCreate(date) {
  const existing = await RecipeOfTheDay.findOne({ date });
  if (existing) return existing;

  if (!pending.has(date)) {
    pending.set(date, generateRecipe(date).finally(() => pending.delete(date)));
  }
  return pending.get(date);
}

// GET /api/recipe-of-the-day?date=YYYY-MM-DD&language=tr
router.get("/recipe-of-the-day", async (req, res) => {
  const date = resolveDate(req.query.date);
  const language = LANGS.includes(req.query.language) ? req.query.language : "en";

  try {
    const doc = await getOrCreate(date);
    const localized = doc[language]?.recipeName ? doc[language] : doc.en;

    return res.json({
      recipe: {
        date: doc.date,
        image: doc.image,
        prepTime: doc.prepTime,
        servings: doc.servings,
        totalCalories: doc.totalCalories,
        totalProtein: doc.totalProtein,
        totalFat: doc.totalFat,
        totalCarbs: doc.totalCarbs,
        recipeName: localized.recipeName,
        description: localized.description,
        ingredients: localized.ingredients,
        steps: localized.steps,
      },
    });
  } catch (err) {
    console.error("Recipe of the day error:", err);
    return res.status(500).json({ error: "Recipe of the day failed" });
  }
});

export const recipeOfTheDayRoute = router;
