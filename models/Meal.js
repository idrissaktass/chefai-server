import mongoose from "mongoose";

const mealSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
    },
    image: {
      type: String,
      required: true,
    },
    date: {
      type: String,
      required: true,
    },
    foods: [
      {
        name: String,
        calories: Number,
        protein: Number,
        fat: Number,
        carbs: Number,
      },
    ],
    totalCalories: {
      type: Number,
      default: 0,
    },
    totalProtein: {
      type: Number,
      default: 0,
    },
    totalFat: {
      type: Number,
      default: 0,
    },
    totalCarbs: {
      type: Number,
      default: 0,
    },
    notes: String,
    mealType: {
      type: String,
      enum: ["breakfast", "lunch", "dinner", "snack"],
      required: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { collection: "meals" }
);

export const Meal = mongoose.model("Meal", mealSchema);
