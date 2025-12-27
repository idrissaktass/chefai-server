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
      required: false,
    },

    
    name: {
      type: String,
      required: false,
    },
authProvider: {
  type: String,
  enum: ["local", "google"],
  default: "local",
},

// -----------------
// PROFILE
// -----------------
age: {
  type: Number,
  default: null,
},

height: {
  type: Number, // cm
  default: null,
},
profileCompleted: {
  type: Boolean,
  default: false,
},
weight: {
  type: Number, // kg
  default: null,
},
weightUnit: {
  type: String,
  enum: ["kg", "lbs"],
  default: "kg",
},
heightUnit: {
  type: String,
  enum: ["cm", "in"],
  default: "cm",
},
gender: {
  type: String,
  enum: ["male", "female"],
  default: null,
},
weightHistory: [
  {
    value: Number,   // kg (HER ZAMAN kg)
    date: {
      type: Date,
      default: Date.now,
    },
  },
],

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
