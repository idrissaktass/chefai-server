import 'dotenv/config'; // dotenv’i otomatik yükler
import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { User } from "../models/User.js";
const router = Router();


// REGISTER
// REGISTER
router.post("/register", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password)
    return res.status(400).json({ error: "Email ve şifre gerekli" });

  const existing = await User.findOne({ email });
  if (existing)
    return res.status(400).json({ error: "Bu email zaten kayıtlı" });

  const hashed = await bcrypt.hash(password, 10);

  const user = new User({ email, password: hashed });
  await user.save();

  // Kayıt başarılı → token üret
  const JWT_SECRET = "d5f721491a7b51a3c83511efd6457e87729f100ee8f2c3191e4f4384c45f373a2f880ac2fef1fb574d43a4f80e9f4181010b925059da21a0a994e895c01ba0eb";
    const token = jwt.sign(
    { id: user._id, isPremium: user.isPremium },
    JWT_SECRET,
    { expiresIn: "7d" }
  );


  res.json({
    message: "Kayıt başarılı",
    token,
    user: { email: user.email }
  });
});

// LOGIN
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email });
  if (!user)
    return res.status(400).json({ error: "Email veya şifre hatalı" });

  const match = await bcrypt.compare(password, user.password);
  if (!match)
    return res.status(400).json({ error: "Email veya şifre hatalı" });

  // JWT secret direkt ekleniyor (env yerine)
  const JWT_SECRET = "d5f721491a7b51a3c83511efd6457e87729f100ee8f2c3191e4f4384c45f373a2f880ac2fef1fb574d43a4f80e9f4181010b925059da21a0a994e895c01ba0eb"; // burada kendi gizli key’ini yaz

   const token = jwt.sign(
    { id: user._id, isPremium: user.isPremium },
    JWT_SECRET,
    { expiresIn: "7d" }
  );

  res.json({
    message: "Giriş başarılı",
    token,
    user: { email: user.email }
  });
});
router.get("/test", (req, res) => {
  res.json({ ok: true, message: "Auth route çalışıyor" });
});


export const authRoute = router;
