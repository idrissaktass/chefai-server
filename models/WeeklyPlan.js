import mongoose from "mongoose";

const weeklyPlanSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },         
  forbiddenFoods: [String], 
  plan: Array,
  shoppingList: Array, // Alışveriş listesi,
  createdAt: { type: Date, default: Date.now },
});

export const WeeklyPlanModel = mongoose.model("WeeklyPlan", weeklyPlanSchema);
