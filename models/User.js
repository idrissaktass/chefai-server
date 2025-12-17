// models/User.js
import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    // -----------------
    // AUTH
    // -----------------
    email: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    password: {
      type: String,
      required: true,
    },

    // -----------------
    // PREMIUM
    // -----------------
    isPremium: {
      type: Boolean,
      default: false,
    },

    premiumPlan: {
      type: String,
      enum: ["premium-monthly", "premium-yearly"],
      default: null,
    },

    premiumSince: {
      type: Date,
      default: null,
    },

    premiumUntil: {
      type: Date,
      default: null, // subscription expiry
    },

    // -----------------
    // FREE USER LIMITS
    // -----------------
    weeklyPlanCount: {
      type: Number,
      default: 0,
    },

    lastPlanDate: {
      type: String, // örn: "2025-W03"
      default: "",
    },

    dailyRecipeCount: {
      type: Number,
      default: 0,
    },

    lastRecipeDate: {
      type: String, // örn: "2025-01-16"
      default: "",
    },
  },
  {
    timestamps: true, // createdAt / updatedAt
  }
);

export const User = mongoose.model("User", userSchema);
