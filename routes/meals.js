import { Router } from "express";
import OpenAI from "openai";
import { Meal } from "../models/Meal.js";
import jwt from "jsonwebtoken";

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET || 
  "d5f721491a7b51a3c83511efd6457e87729f100ee8f2c3191e4f4384c45f373a2f880ac2fef1fb574d43a4f80e9f4181010b925059da21a0a994e895c01ba0eb";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// AUTH MIDDLEWARE
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  console.log("[Meals Auth] Authorization header:", authHeader ? "EXISTS" : "MISSING");
  
  if (!authHeader) {
    console.log("[Meals Auth] No auth header provided");
    return res.status(401).json({ error: "Token yok" });
  }

  const parts = authHeader.split(" ");
  const token = parts[1];
  
  console.log("[Meals Auth] Header parts:", parts.length, "Token:", token ? "EXISTS" : "MISSING");
  
  if (!token) {
    console.log("[Meals Auth] No token in header");
    return res.status(401).json({ error: "Token yok" });
  }

  try {
    console.log("[Meals Auth] Verifying token with JWT_SECRET...");
    const decoded = jwt.verify(token, JWT_SECRET);
    console.log("[Meals Auth] Token verified! UserId:", decoded.id);
    req.userId = decoded.id;
    next();
  } catch (err) {
    console.log("[Meals Auth] JWT verify ERROR:", err.message);
    return res.status(401).json({ error: "Geçersiz token" });
  }
};


// PROMPTS
const analyzeImagePromptTR = `
Yemek fotoğrafını analiz et ve aşağıdaki JSON formatında yanıt ver. 
Fotoğrafta gördüğün miktarları porsiyon bazlı olarak tahmin et.

{
  "foods": [
    {
      "name": "yemek adı (Türkçe)",
      "gramage": "AI'nın tahmin ettiği gramaj (örn: 250)",
      "calories": "Toplam kalori",
      "protein": "Toplam protein gram",
      "fat": "Toplam yağ gram",
      "carbs": "Toplam karbonhidrat gram"
    }
  ],
  "totalCalories": toplam kalori,
  "totalProtein": toplam protein gram,
  "totalFat": toplam yağ gram,
  "totalCarbs": toplam karbonhidrat gram
}

KURALLAR:
- Her bir yiyecek maddesini ayrı olarak listele
- Kalori, protein, yağ ve karbonhidratı 100 gram için tahmin et
- gramage her zaman 100 olarak başlasın
- Porsiyonları fotoğraftan görüntüye göre belirle
- Sadece JSON döndür, başka birşey yazma
`;

const analyzeImagePromptEN = `
Analyze the meal in the photo. Estimate the portion size in grams and calculate the nutritional values based on that specific weight.
Respond ONLY with a valid JSON.

{
  "foods": [
    {
      "name": "Food name",
      "gramage": 250,
      "calories": 400,
      "protein": 30,
      "fat": 15,
      "carbs": 40
    }
  ],
  "totalCalories": 400,
  "totalProtein": 30,
  "totalFat": 15,
  "totalCarbs": 40
}

RULES:
- Gramage must be the estimated portion weight (not fixed at 100g).
- Calories, protein, fat, and carbs must be calculated based on the estimated 'gramage'.
- List each food item separately
- Estimate calories, protein, fat and carbs per 100 grams
- gramage always starts at 100
- Determine portions based on what you see in the photo
- Return only JSON, nothing else
`;

// ANALYZE MEAL IMAGE
router.post("/analyze-meal", authMiddleware, async (req, res) => {
  try {
    const { image, language = "en" } = req.body;
    if (!image) return res.status(400).json({ error: "Görüntü gerekli" });

    const prompt = language === "tr" ? analyzeImagePromptTR : analyzeImagePromptEN;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system", 
          content: "Sen uzman bir diyetisyen ve besin analistisin. Her zaman geçerli JSON döndürürsün."
        },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image}` } },
            { type: "text", text: prompt },
          ],
        },
      ],
      response_format: { type: "json_object" }, // GPT-4o JSON modunu zorlar
      max_tokens: 1024,
    });

    const content = response.choices[0].message.content;
    const analysisResult = JSON.parse(content); // json_object kullandığımız için direkt parse edebiliriz

    res.json(analysisResult);
  } catch (error) {
    console.error("Analyze meal error:", error);
    res.status(500).json({ error: "Analiz başarısız oldu" });
  }
});

// ANALYZE MEAL BY TEXT (Manual entry)
router.post("/analyze-meal-text", authMiddleware, async (req, res) => {
  try {
    const { mealName, mealType = "snack", language = "en" } = req.body;
    if (!mealName) return res.status(400).json({ error: "Meal name required" });

    const textPrompt = language === "tr"
      ? `Yemek adı: "${mealName}" (Tip: ${mealType}). Bu yemeğin beslenme değerini tahmin et ve aşağıdaki JSON formatında yanıt ver:
{
  "foods": [
    {
      "name": "yemek adı",
      "gramage": 200,
      "calories": 450,
      "protein": 35,
      "fat": 15,
      "carbs": 45
    }
  ],
  "totalCalories": 450,
  "totalProtein": 35,
  "totalFat": 15,
  "totalCarbs": 45
}
KURALLAR:
- Porsiyon boyutunu makul tahmin et (gramage)
- Kalori, protein, yağ ve karbonhidratları tahmin et
- Sadece JSON döndür, başka birşey yazma`
      : `Meal name: "${mealName}" (Type: ${mealType}). Estimate the nutritional values and respond with this JSON format:
{
  "foods": [
    {
      "name": "meal name",
      "gramage": 200,
      "calories": 450,
      "protein": 35,
      "fat": 15,
      "carbs": 45
    }
  ],
  "totalCalories": 450,
  "totalProtein": 35,
  "totalFat": 15,
  "totalCarbs": 45
}
RULES:
- Estimate reasonable portion size (gramage in grams)
- Estimate calories, protein, fat, and carbs
- Return only JSON`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are an expert nutritionist and food analyst. Always return valid JSON."
        },
        {
          role: "user",
          content: textPrompt,
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 512,
    });

    const content = response.choices[0].message.content;
    const analysisResult = JSON.parse(content);
    res.json(analysisResult);
  } catch (error) {
    console.error("Analyze meal text error:", error);
    res.status(500).json({ error: "Analysis failed" });
  }
});

// SAVE MEAL
router.post("/meals", authMiddleware, async (req, res) => {
  try {
    const {
      image,
      date,
      foods,
      totalCalories,
      totalProtein,
      totalFat,
      totalCarbs,
      notes,
      mealName,
      mealType,
    } = req.body;

    const meal = new Meal({
      userId: req.userId,
      image,
      date,
      foods,
      totalCalories,
      totalProtein,
      totalFat,
      totalCarbs,
      notes,
      mealName,
      mealType: mealType || "snack",
    });

    await meal.save();
    res.json(meal);
  } catch (error) {
    console.error("Save meal error:", error);
    res.status(500).json({ error: "Yemek kaydedilirken hata oluştu" });
  }
});

// GET USER MEALS
router.get("/meals", authMiddleware, async (req, res) => {
  try {
    const meals = await Meal.find({ userId: req.userId }).sort({
      createdAt: -1,
    });
    res.json(meals);
  } catch (error) {
    console.error("Get meals error:", error);
    res.status(500).json({ error: "Yemekler alınırken hata oluştu" });
  }
});

// GET SINGLE MEAL
router.get("/meals/:id", authMiddleware, async (req, res) => {
  try {
    const meal = await Meal.findById(req.params.id);

    if (!meal) {
      return res.status(404).json({ error: "Yemek bulunamadı" });
    }

    if (meal.userId !== req.userId) {
      return res.status(403).json({ error: "Yetkisiz erişim" });
    }

    res.json(meal);
  } catch (error) {
    console.error("Get meal error:", error);
    res.status(500).json({ error: "Yemek alınırken hata oluştu" });
  }
});

// DELETE MEAL
router.delete("/meals/:id", authMiddleware, async (req, res) => {
  try {
    const meal = await Meal.findById(req.params.id);

    if (!meal) {
      return res.status(404).json({ error: "Yemek bulunamadı" });
    }

    if (meal.userId !== req.userId) {
      return res.status(403).json({ error: "Yetkisiz erişim" });
    }

    await Meal.findByIdAndDelete(req.params.id);
    res.json({ message: "Yemek silindi" });
  } catch (error) {
    console.error("Delete meal error:", error);
    res.status(500).json({ error: "An error occurred while deleting the meal" });
  }
});

// UPDATE MEAL
router.put("/meals/:id", authMiddleware, async (req, res) => {
  try {
    const meal = await Meal.findById(req.params.id);

    if (!meal) {
      return res.status(404).json({ error: "Yemek bulunamadı" });
    }

    if (meal.userId !== req.userId) {
      return res.status(403).json({ error: "Yetkisiz erişim" });
    }

    const { foods, totalCalories, totalProtein, totalFat, totalCarbs, notes } =
      req.body;

    if (foods) meal.foods = foods;
    if (totalCalories) meal.totalCalories = totalCalories;
    if (totalProtein) meal.totalProtein = totalProtein;
    if (totalFat) meal.totalFat = totalFat;
    if (totalCarbs) meal.totalCarbs = totalCarbs;
    if (notes !== undefined) meal.notes = notes;

    await meal.save();
    res.json(meal);
  } catch (error) {
    console.error("Update meal error:", error);
    res.status(500).json({ error: "Yemek güncellenirken hata oluştu" });
  }
});

export const mealRoute = router;
