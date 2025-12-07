import { Router } from "express";
import { SavedRecipe } from "../models/SavedRecipe.js";
import jwt from "jsonwebtoken";
import { User } from "../models/User.js";

const router = Router();

const JWT_SECRET =
  "d5f721491a7b51a3c83511efd6457e87729f100ee8f2c3191e4f4384c45f373a2f880ac2fef1fb574d43a4f80e9f4181010b925059da21a0a994e895c01ba0eb";

export const verifyToken = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header)
    return res.status(401).json({ error: "Token yok" });

  try {
    const token = header.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    req.userId = decoded.id;

    // 🔥 BURASI EKSİKTİ → user'ı DB'den çekiyoruz
    const user = await User.findById(decoded.id);

    if (!user) {
      return res.status(401).json({ error: "Kullanıcı bulunamadı" });
    }

    req.user = user;              // ⭐ user artık burada
    req.isPremium = user.isPremium; // ⭐ save-recipe bunu okuyabilir

    next();
  } catch (err) {
    return res.status(401).json({ error: "Geçersiz token" });
  }
};
// TARİF KAYDET
router.post("/save-recipe", verifyToken, async (req, res) => {
  const { 
    recipeName, totalCalories, totalProtein, totalFat, totalCarbs, steps, ingredientsCalories, image
  } = req.body;

  const user = req.user;

  // Toplam tarif sayısı
  const count = await SavedRecipe.countDocuments({ userId: req.userId });

  // FREE kullanıcı max 5 tarif kaydedebilir
  if (!user.isPremium && count >= 55) {
    return res.status(403).json({
      errorCode: "RECIPE_LIMIT_REACHED",
      message: "Ücretsiz kullanıcılar en fazla 5 tarif kaydedebilir."
    });
  }


  // Aynı tarif zaten varsa önle
  const existing = await SavedRecipe.findOne({
    userId: req.userId,
    recipeName,
    totalCalories
  });

  if (existing) {
    return res.status(400).json({
      message: "Bu tarif zaten kayıtlı"
    });
  }

  const saved = await SavedRecipe.create({
    userId: req.userId,
    recipeName,
    totalCalories,
    totalProtein,
    totalFat,
    totalCarbs,
    steps,
    ingredientsCalories,
    image
  });

  res.json({ message: "Kaydedildi", saved });
});


// KULLANICININ TARİFLERİNİ GETİR
router.get("/my-recipes", verifyToken, async (req, res) => {
  const recipes = await SavedRecipe.find({ userId: req.userId });
  res.json({ recipes });
});

// TARİF SİL
router.delete("/delete-recipe/:id", verifyToken, async (req, res) => {
  const recipeId = req.params.id;

  const deleted = await SavedRecipe.findOneAndDelete({
    _id: recipeId,
    userId: req.userId,
  });

  if (!deleted) return res.status(404).json({ message: "Tarif bulunamadı" });

  res.json({ message: "Tarif silindi" });
});

router.get("/saved/test", (req, res) => {
  res.json({ ok: true, message: "Auth route çalışıyor" });
});

export const savedRecipeRoute = router;
