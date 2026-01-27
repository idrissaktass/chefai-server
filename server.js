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

dotenv.config();
connectDB();

const app = express();
app.use(cors());

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use((req, res, next) => {
  if (req.url.includes("update-recipe-image")) {
    console.log("📩 Incoming:", req.method, req.url, req.body);
  }
  next();
});
app.use("/api/auth", authRoute);
app.use("/api", recipeRoute);
app.use("/api", savedRecipeRoute);
app.use("/api", weeklyPlanRoute);
app.use("/api", shoppingListRoute);
app.use("/api/premium", premiumRoutes);

const port = process.env.PORT || 8080;
app.listen(port, () => console.log("Server running on port", port));

export default app;
