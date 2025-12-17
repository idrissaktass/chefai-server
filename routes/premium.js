import express from "express";
import { User } from "../models/User.js";
import jwt from "jsonwebtoken";

const router = express.Router();
const JWT_SECRET =
  "d5f721491a7b51a3c83511efd6457e87729f100ee8f2c3191e4f4384c45f373a2f880ac2fef1fb574d43a4f80e9f4181010b925059da21a0a994e895c01ba0eb";

const authMiddleware = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "No token" });

  try {
    const token = header.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}
router.post("/verify", authMiddleware, async (req, res) => {
  try {
    const userId = req.userId; // authMiddleware’den geliyor
    const { productId, receipt, platform } = req.body;

    if (!productId || !receipt) {
      return res.status(400).json({ error: "Missing data" });
    }

    // -----------------------------
    // 🚧 ŞİMDİLİK MOCK DOĞRULAMA
    // -----------------------------
    // TODO:
    // - iOS: Apple verifyReceipt
    // - Android: Google Play Developer API

    const isValid = true; // TEST İÇİN

    if (!isValid) {
      return res.status(400).json({ error: "Invalid receipt" });
    }

    // -----------------------------
    // USER’I PREMIUM YAP
    // -----------------------------
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    user.isPremium = true;
    user.premiumPlan = productId;
    user.premiumSince = new Date();

    await user.save();

    return res.json({
      success: true,
      isPremium: true,
      premiumPlan: productId,
    });
  } catch (err) {
    console.error("Premium verify error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

export const premiumRoutes = router;
;
