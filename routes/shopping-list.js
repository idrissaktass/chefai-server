import { Router } from "express";
import OpenAI from "openai";
import { WeeklyPlanModel } from "../models/WeeklyPlan.js";
import jwt from "jsonwebtoken";

const router = Router();

const JWT_SECRET = "d5f721491a7b51a3c83511efd6457e87729f100ee8f2c3191e4f4384c45f373a2f880ac2fef1fb574d43a4f80e9f4181010b925059da21a0a994e895c01ba0eb";

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Token yok" });

  const token = authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Token yok" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch (err) {
    console.log("JWT verify error:", err.message);
    return res.status(401).json({ error: "Geçersiz token" });
  }
};

router.post("/shopping-list", authMiddleware, async (req, res) => {
  const { program } = req.body;
  if (!program) return res.status(400).json({ error: "Eksik program" });

  try {
    // Son planı getir
    const lastPlan = await WeeklyPlanModel.findOne({ userId: req.userId }).sort({ createdAt: -1 });

    if (!lastPlan) return res.status(404).json({ error: "Plan bulunamadı" });

    // Eğer zaten kayıtlı bir alışveriş listesi varsa, AI’yi çağırma
    if (lastPlan.shoppingList && lastPlan.shoppingList.length > 0) {
      return res.json({ savedList: lastPlan.shoppingList });
    }

    // AI’den oluştur
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const prompt = `
    Haftalık yemek programı: ${JSON.stringify(program)}.
    Sadece yemeklerin malzemelerini (domates, süt, un, limon, kinoa) listele. Kullanıcıya bir market listesi hazırla.
    - Yemek adlarını kesinlikle yazma (karnıyarık, dolma, pilav, mevsim salatası, haşlanmış yumurta, kebap, kebab gibi böyle şeyler yazma)
    - Çorba, salata, yemek türü kelimelerini yazma
    - Tekrar eden malzemeleri tek yaz
    - Sadece JSON formatı: {"list": ["malzeme1","malzeme2",...]} 
    - Başka hiçbir açıklama, yorum, başlık veya ek bilgi yazma
    `;

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1000,
      temperature: 0.7,
    });

    const raw = completion.choices[0].message.content;
    let data;
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("JSON bulunamadı");
      data = JSON.parse(jsonMatch[0]);
    } catch (err) {
      console.log("JSON parse hatası:", err, "Raw:", raw);
      return res.status(500).json({ error: "Shopping list parse hatası" });
    }

    lastPlan.shoppingList = data.list;
    await lastPlan.save();

    res.json({ list: data.list || [] });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "OpenAI shopping list error" });
  }
});
router.post("/shopping-list/remove", authMiddleware, async (req, res) => {
  try {
    const { item } = req.body;

    if (!item) return res.status(400).json({ error: "Silinecek ürün yok" });

    const planDoc = await WeeklyPlanModel.findOne({ userId: req.userId }).sort({
      createdAt: -1,
    });

    if (!planDoc) return res.status(404).json({ error: "Plan bulunamadı" });

    // Eğer alışveriş listesi yoksa oluştur
    if (!planDoc.shoppingList) planDoc.shoppingList = [];

    // Listeden item sil
    planDoc.shoppingList = planDoc.shoppingList.filter(
      (i) => i.toLowerCase() !== item.toLowerCase()
    );

    await planDoc.save();

    res.json({
      success: true,
      shoppingList: planDoc.shoppingList,
    });
  } catch (err) {
    console.log("removeShoppingItem error:", err);
    res.status(500).json({ error: "Silme işlemi başarısız" });
  }
});
router.get("/list/test", (req, res) => {
  res.json({ ok: true, message: "Auth route çalışıyor" });
});
export const shoppingListRoute = router;
