import mongoose from "mongoose";

const recipeSchema = new mongoose.Schema({
  name: { type: String, unique: true }, // yemek ismi
  ingredients: [
    {
      ingredient: String,
      amount: String
    }
  ],
  steps: [String],
  dietMode: { type: String, default: "normal" },
  imageUrl: { type: String }, // ⭐ EKLENDİ ⭐
    prepTime: {
    type: Number,
    default: 10 // güvenli fallback
  }
});

export const Recipe = mongoose.model("Recipe", recipeSchema);
