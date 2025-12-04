import mongoose from "mongoose";

const SavedRecipeSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  recipeName: { type: String, required: true },
  totalCalories: { type: Number, required: true },
  totalProtein: { type: Number, default: 0 },  // yeni alan
  totalFat: { type: Number, default: 0 },      // yeni alan
  totalCarbs: { type: Number, default: 0 },    // yeni alan
    ingredients: [
    {
      name: String,
      amount: String,
      calories: Number
    }
  ],
  steps: { type: [String], default: [] },
  ingredientsCalories: { type: Object, default: {} },
}, { timestamps: true });

export const SavedRecipe = mongoose.model("SavedRecipe", SavedRecipeSchema);
