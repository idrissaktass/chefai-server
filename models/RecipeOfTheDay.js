import mongoose from "mongoose";

const ingredientSchema = new mongoose.Schema(
  {
    name:     { type: String, default: "" },
    amount:   { type: String, default: "" },
    calories: { type: Number, default: 0 },
  },
  { _id: false }
);

const localizedSchema = new mongoose.Schema(
  {
    recipeName:  { type: String, default: "" },
    description: { type: String, default: "" },
    ingredients: { type: [ingredientSchema], default: [] },
    steps:       { type: [String], default: [] },
  },
  { _id: false }
);

// Herkes için ortak, günde bir tane — kullanıcı hakkı harcamaz
const recipeOfTheDaySchema = new mongoose.Schema({
  date:          { type: String, required: true, unique: true }, // "YYYY-MM-DD"
  theme:         { type: String, default: "" },
  basicName:     { type: String, default: "" },
  image:         { type: String, default: null },
  prepTime:      { type: Number, default: 0 },
  servings:      { type: Number, default: 1 },
  totalCalories: { type: Number, default: 0 },
  totalProtein:  { type: Number, default: 0 },
  totalFat:      { type: Number, default: 0 },
  totalCarbs:    { type: Number, default: 0 },
  tr: { type: localizedSchema, default: () => ({}) },
  en: { type: localizedSchema, default: () => ({}) },
  de: { type: localizedSchema, default: () => ({}) },
  fr: { type: localizedSchema, default: () => ({}) },
  es: { type: localizedSchema, default: () => ({}) },
  createdAt: { type: Date, default: Date.now },
});

export const RecipeOfTheDay = mongoose.model("RecipeOfTheDay", recipeOfTheDaySchema);
