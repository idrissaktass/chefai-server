import express from "express";
import axios from "axios";
import { User } from "../models/User.js"; // Model isimlendirmene göre süslü parantezli veya parantezsiz kullan
import jwt from "jsonwebtoken";

const router = express.Router();

const ENTITLEMENT_ID = "premium_access"; // RevenueCat Dashboard'daki ID ile aynı olmalı
const JWT_SECRET = process.env.JWT_SECRET || "d5f721491a7b51a3c83511efd6457e87729f100ee8f2c3191e4f4384c45f373a2f880ac2fef1fb574d43a4f80e9f4181010b925059da21a0a994e895c01ba0eb";

// Kimlik Doğrulama Middleware (Güvenlik için)
const authMiddleware = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "No token provided" });

  try {
    const token = header.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
};

/**
 * @route   POST /premium/sync
 * @desc    RevenueCat üzerinden abonelik durumunu doğrular ve DB'yi günceller
 */
router.post("/sync", authMiddleware, async (req, res) => {
  try {
    // Frontend'den gelen userId veya authMiddleware'den gelen req.userId kullanılabilir
    const userId = req.userId; 
    const { appUserId } = req.body; // RevenueCat'teki identify ID'si

    if (!appUserId) {
      return res.status(400).json({ error: "appUserId is required" });
    }

    // 1. RevenueCat API'den kullanıcı bilgilerini çek
    const response = await axios.get(
      `https://api.revenuecat.com/v1/subscribers/${appUserId}`,
      {
        headers: { 
            Authorization: `Bearer ${process.env.REVENUECAT_SECRET}`,
            "Content-Type": "application/json"
        }
      }
    );

    const entitlements = response.data.subscriber.entitlements || {};
    
    // 2. Belirlenen Entitlement ID aktif mi kontrol et
    // RevenueCat v1 formatında entitlement doğrudan anahtar olarak gelir
    const premiumEntitlement = entitlements[ENTITLEMENT_ID];
    
    // Eğer entitlement varsa ve bitiş tarihi geçmemişse (veya null ise sonsuzdur) isPremium true olur
    const isPremium = !!premiumEntitlement;
    const expiresDate = premiumEntitlement ? premiumEntitlement.expires_date : null;

    // 3. Veritabanındaki kullanıcıyı güncelle
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { 
        isPremium: isPremium, 
        premiumExpiresAt: expiresDate,
        premiumPlan: premiumEntitlement?.product_identifier || null 
      },
      { new: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ error: "User not found in database" });
    }

    console.log(`Sync complete for user ${userId}. Premium: ${isPremium}`);

    // 4. Frontend'in beklediği formatta yanıt dön
    return res.json({ 
      success: true,
      isPremium: updatedUser.isPremium,
      expiresAt: updatedUser.premiumExpiresAt
    });

  } catch (err) {
    console.error("RC Sync Error:", err.response?.data || err.message);
    return res.status(500).json({ 
      error: "Sync failed", 
      details: err.response?.data?.message || err.message 
    });
  }
});

export const premiumRoutes = router;