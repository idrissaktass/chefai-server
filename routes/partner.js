import express from "express";
import jwt from "jsonwebtoken";
import { User } from "../models/User.js";
import { Meal } from "../models/Meal.js";

const router = express.Router();

const JWT_SECRET =
  process.env.JWT_SECRET ||
  "d5f721491a7b51a3c83511efd6457e87729f100ee8f2c3191e4f4384c45f373a2f880ac2fef1fb574d43a4f80e9f4181010b925059da21a0a994e895c01ba0eb";

const auth = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "No token" });
  try {
    const token = header.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) return res.status(401).json({ error: "User not found" });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
};

// Generate a unique pair code for the current user
router.post("/generate-code", auth, async (req, res) => {
  try {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    req.user.pairCode = code;
    await req.user.save();
    res.json({ code });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Connect with someone using their code (adds to partnerIds array)
router.post("/connect", auth, async (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ error: "Code required" });

    const partner = await User.findOne({ pairCode: code.trim().toUpperCase() });
    if (!partner) return res.status(404).json({ error: "CODE_NOT_FOUND" });
    if (partner._id.equals(req.user._id))
      return res.status(400).json({ error: "Cannot pair with yourself" });

    // Check not already connected
    const alreadyConnected = req.user.partnerIds?.some((id) => id.equals(partner._id));
    if (alreadyConnected) return res.status(400).json({ error: "Already connected" });

    // Add each other to partnerIds
    req.user.partnerIds = [...(req.user.partnerIds ?? []), partner._id];
    partner.partnerIds = [...(partner.partnerIds ?? []), req.user._id];
    await Promise.all([req.user.save(), partner.save()]);

    res.json({ partner: { name: partner.name, id: partner._id } });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// List all connected partners with today's calories
router.get("/partners", auth, async (req, res) => {
  try {
    const ids = req.user.partnerIds ?? [];
    if (ids.length === 0) return res.json({ partners: [] });

    const today = new Date().toISOString().split("T")[0];
    const users = await User.find({ _id: { $in: ids } });

    const partners = await Promise.all(
      users.map(async (u) => {
        const meals = await Meal.find({ userId: String(u._id), date: { $regex: `^${today}` } });
        const todayCalories = Math.round(
          meals.reduce((s, m) => s + (m.totalCalories || 0), 0)
        );
        return { _id: u._id, name: u.name, todayCalories };
      })
    );

    res.json({ partners });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Get detailed summary for a specific partner
router.get("/summary/:partnerId", auth, async (req, res) => {
  try {
    const pid = req.params.partnerId;
    const isConnected = req.user.partnerIds?.some((id) => String(id) === pid);
    if (!isConnected) return res.status(403).json({ error: "NOT_CONNECTED" });

    const partner = await User.findById(pid);
    if (!partner) {
      req.user.partnerIds = req.user.partnerIds.filter((id) => String(id) !== pid);
      await req.user.save();
      return res.status(404).json({ error: "NO_PARTNER" });
    }

    const today = new Date().toISOString().split("T")[0];
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      return d.toISOString().split("T")[0];
    });

    const [todayMeals, recentMeals] = await Promise.all([
      Meal.find({ userId: pid, date: { $regex: `^${today}` } }),
      Meal.find({ userId: pid, $or: days.map((d) => ({ date: { $regex: `^${d}` } })) }),
    ]);

    const todayTotals = todayMeals.reduce(
      (acc, m) => ({
        calories: acc.calories + (m.totalCalories || 0),
        protein:  acc.protein  + (m.totalProtein  || 0),
        carbs:    acc.carbs    + (m.totalCarbs    || 0),
        fat:      acc.fat      + (m.totalFat      || 0),
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0 }
    );
    Object.keys(todayTotals).forEach((k) => {
      todayTotals[k] = Math.round(todayTotals[k]);
    });

    const weeklyCalories = days.map((day) => {
      const cal = recentMeals
        .filter((m) => m.date === day)
        .reduce((s, m) => s + (m.totalCalories || 0), 0);
      return { date: day, calories: Math.round(cal) };
    });

    const simpleMeals = todayMeals.map((m) => ({
      type: m.mealType,
      name: m.mealName || m.foods?.[0]?.name || "",
      calories: Math.round(m.totalCalories || 0),
    }));

    res.json({
      partner: { name: partner.name, weight: partner.weight, goalWeight: partner.goalWeight },
      todayTotals,
      todayMeals: simpleMeals,
      weeklyCalories,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Disconnect a specific partner
router.delete("/disconnect/:partnerId", auth, async (req, res) => {
  try {
    const pid = req.params.partnerId;
    req.user.partnerIds = (req.user.partnerIds ?? []).filter((id) => String(id) !== pid);
    await req.user.save();

    const partner = await User.findById(pid);
    if (partner) {
      partner.partnerIds = (partner.partnerIds ?? []).filter(
        (id) => String(id) !== String(req.user._id)
      );
      await partner.save();
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export { router as partnerRoute };
