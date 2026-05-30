import { Router } from "express";
import OpenAI from "openai";
import { Meal } from "../models/Meal.js";
import jwt from "jsonwebtoken";

const router = Router();

const JWT_SECRET =
  "d5f721491a7b51a3c83511efd6457e87729f100ee8f2c3191e4f4384c45f373a2f880ac2fef1fb574d43a4f80e9f4181010b925059da21a0a994e895c01ba0eb";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// AUTH MIDDLEWARE
const authMiddleware = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "Token yok" });

  try {
    const token = header.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch {
    return res.status(401).json({ error: "Geçersiz token" });
  }
};

// PROMPTS
const analyzeImagePromptTR = `
Verilen yemek fotoğrafını analiz et ve aşağıdaki JSON formatında yanıt ver:

{
  "foods": [
    {
      "name": "yemek adı (Türkçe)",
      "calories": kalori sayısı,
      "protein": protein gram,
      "fat": yağ gram,
      "carbs": karbonhidrat gram
    }
  ],
  "totalCalories": toplam kalori,
  "totalProtein": toplam protein gram,
  "totalFat": toplam yağ gram,
  "totalCarbs": toplam karbonhidrat gram
}

KURALLAR:
- Her bir yiyecek maddesini ayrı olarak listele
- Kalori, protein, yağ ve karbonhidratı makul şekilde tahmin et
- Porsiyonları fotoğraftan görüntüye göre belirle
- Sadece JSON döndür, başka birşey yazma
`;

const analyzeImagePromptEN = `
Analyze the meal in the food photo and respond in the following JSON format:

{
  "foods": [
    {
      "name": "food name",
      "calories": calorie number,
      "protein": protein grams,
      "fat": fat grams,
      "carbs": carbohydrate grams
    }
  ],
  "totalCalories": total calories,
  "totalProtein": total protein grams,
  "totalFat": total fat grams,
  "totalCarbs": total carbohydrate grams
}

RULES:
- List each food item separately
- Estimate calories, protein, fat and carbs reasonably
- Determine portions based on what you see in the photo
- Return only JSON, nothing else
`;

// ANALYZE MEAL IMAGE
router.post("/analyze-meal", authMiddleware, async (req, res) => {
  try {
    const { image, language = "en" } = req.body;

    if (!image) {
      return res.status(400).json({ error: "Görüntü gerekli" });
    }

    const prompt =
      language === "tr" ? analyzeImagePromptTR : analyzeImagePromptEN;

    // Call OpenAI Vision API
    const response = await openai.chat.completions.create({
      model: "gpt-4-turbo",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${image}`,
              },
            },
            {
              type: "text",
              text: prompt,
            },
          ],
        },
      ],
      max_tokens: 1024,
    });

    const content = response.choices[0].message.content;

    // Parse JSON from response
    const jsonMatch = content?.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(400).json({ error: "Analiz sırasında hata oluştu" });
    }

    const analysisResult = JSON.parse(jsonMatch[0]);

    res.json(analysisResult);
  } catch (error) {
    console.error("Analyze meal error:", error);
    res.status(500).json({
      error: error.message || "Analiz sırasında hata oluştu",
    });
  }
});

// SAVE MEAL
router.post("/meals", authMiddleware, async (req, res) => {
  try {
    const { image, date, foods, totalCalories, totalProtein, totalFat, totalCarbs, notes } =
      req.body;

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
    res.status(500).json({ error: "Yemek silinirken hata oluştu" });
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
