import mongoose from "mongoose";

const SavedRecipeSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  recipeName: { type: String, required: true },
  
  // Makro Besinler
  totalCalories: { type: Number},
  totalProtein: { type: Number, default: 0 }, 
  totalFat: { type: Number, default: 0 },      
  totalCarbs: { type: Number, default: 0 },    
  
  // ⭐ YENİ ALANLAR BURADA ⭐
  prepTime: { type: String, default: '—' },  // Hazırlık Süresi (örn: "30")
  servings: { type: String, default: '—' },  // Porsiyon (örn: "4")

  // Malzemeler listesi
  ingredients: [
    {
      name: String,
      amount: String,
      calories: Number
    }
  ],
  
  // Adımlar ve Kalori Dağılımı
  steps: { type: [String], default: [] },
  ingredientsCalories: { type: Object, default: {} }, // Malzeme bazlı kalori dağılımı
  
  // Görsel
  image: { type: String, default: null }, 
  
}, { timestamps: true });

export const SavedRecipe = mongoose.model("SavedRecipe", SavedRecipeSchema);