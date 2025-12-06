import mongoose from "mongoose";

const weeklyPlanSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  forbiddenFoods: [String], 
  plan: Array,
  shoppingList: Array,
  dietMode: { type: String, default: "normal" },   // 🔥 EKLEDİK
  createdAt: { type: Date, default: Date.now },
  date: String
});


export const WeeklyPlanModel = mongoose.model("WeeklyPlan", weeklyPlanSchema);
