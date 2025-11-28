// models/User.js
import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  isPremium: { type: Boolean, default: false },

  // FREE kullanıcı limitleri:
  weeklyPlanCount: { type: Number, default: 0 },  // haftalık plan sayacı
  lastPlanDate: { type: String, default: "" },    // hangi hafta
  dailyRecipeCount: { type: Number, default: 0 }, // günlük AI tarif sayacı
  lastRecipeDate: { type: String, default: "" }
});

export const User = mongoose.model("User", userSchema);
