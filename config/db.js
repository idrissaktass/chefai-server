// config/db.js
import mongoose from "mongoose";
import dns from 'node:dns/promises';

// 1. DNS Ayarı: MongoDB Atlas bağlantı sorunlarını önlemek için
const configureDNS = async () => {
    try {
        await dns.setServers(['1.1.1.1', '8.8.8.8']);
        console.log("🌐 DNS: Cloudflare ve Google sunucuları tanımlandı.");
    } catch (err) {
        console.error("❌ DNS Ayarı Başarısız:", err);
    }
};
configureDNS();


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
