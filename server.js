import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import { connectDB } from "./config/db.js";

import { recipeRoute } from "./routes/recipe.js";
import { authRoute } from "./routes/auth.js";
import { savedRecipeRoute } from "./routes/savedRecipes.js";
import { weeklyPlanRoute } from "./routes/weeklyPlan.js";
import { shoppingListRoute } from "./routes/shopping-list.js";
import { premiumRoutes } from "./routes/premium.js";
import { mealRoute } from "./routes/meals.js";
import { openaiRoute } from "./routes/openai.js";
import { dailySuggestionRoute } from "./routes/dailySuggestion.js";
import { partnerRoute } from "./routes/partner.js";

dotenv.config();
connectDB();

const app = express();
app.use(cors());

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// 🔥 Global request logging
app.use((req, res, next) => {
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  if (req.body && Object.keys(req.body).length > 0) {
    console.error("[BODY]", JSON.stringify(req.body).substring(0, 200));
  }
  next();
});

app.use((req, res, next) => {
  if (req.url.includes("update-recipe-image")) {
    console.error("📩 Incoming:", req.method, req.url, req.body);
  }
  next();
});
app.use("/api/auth", authRoute);
app.use("/api", recipeRoute);
app.use("/api", savedRecipeRoute);
app.use("/api", weeklyPlanRoute);
app.use("/api", shoppingListRoute);
app.use("/api/premium", premiumRoutes);
app.use("/api", mealRoute);
app.use("/api/openai", openaiRoute);
app.use("/api", dailySuggestionRoute);
app.use("/api/partner", partnerRoute);

const port = process.env.PORT || 8080;
app.listen(port, () => console.log("Server running on port", port));

export default app;
