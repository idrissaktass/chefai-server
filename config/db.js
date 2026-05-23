// config/db.js
import mongoose from "mongoose";

export const connectDB = async () => {
  try {
    await mongoose.connect(
      "mongodb+srv://idrissaktass98_db_user:Aktas0198.@cluster0.9u31bz2.mongodb.net/?appName=Cluster0"
    );
    console.log("MongoDB connected");
  } catch (error) {
    console.error("DB error:", error);
    process.exit(1);
  }
};
