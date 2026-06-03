import mongoose from "mongoose";

const mealSuggestionSchema = new mongoose.Schema(
  {
    name_tr: { type: String, default: "" },
    name_en: { type: String, default: "" },
    cal:     { type: Number, default: 0 },
    protein: { type: Number, default: 0 },
    carbs:   { type: Number, default: 0 },
    fat:     { type: Number, default: 0 },
    confirmed: { type: Boolean, default: false },
  },
  { _id: false }
);

const dailySuggestionSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  date:      { type: String, required: true }, // "YYYY-MM-DD"
  targetCal: { type: Number, default: 2000 },
  breakfast: { type: mealSuggestionSchema, default: () => ({}) },
  lunch:     { type: mealSuggestionSchema, default: () => ({}) },
  snack:     { type: mealSuggestionSchema, default: () => ({}) },
  dinner:    { type: mealSuggestionSchema, default: () => ({}) },
  createdAt: { type: Date, default: Date.now },
});

// userId + date combination must be unique — one doc per user per day
dailySuggestionSchema.index({ userId: 1, date: 1 }, { unique: true });

export const DailySuggestion = mongoose.model("DailySuggestion", dailySuggestionSchema);
