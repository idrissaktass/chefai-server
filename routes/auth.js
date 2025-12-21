import 'dotenv/config'; // dotenv’i otomatik yükler
import { Router } from "express";
import { OAuth2Client } from "google-auth-library";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { User } from "../models/User.js";
const router = Router();

const GOOGLE_WEB_CLIENT_ID =
   "509344696126-684b6nigs3e5i43q98gcjtag1eg6n537.apps.googleusercontent.com";

const googleClient = new OAuth2Client(GOOGLE_WEB_CLIENT_ID);

router.post("/google", async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ error: "NO_TOKEN" });
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: GOOGLE_WEB_CLIENT_ID,
    });

    const payload = ticket.getPayload();

    if (!payload?.email) {
      return res.status(400).json({ error: "NO_EMAIL" });
    }

    let user = await User.findOne({ email: payload.email });

    if (!user) {
      user = new User({
        email: payload.email,
        authProvider: "google",
        profileCompleted: false,
      });
      await user.save();
    }
  const JWT_SECRET = "d5f721491a7b51a3c83511efd6457e87729f100ee8f2c3191e4f4384c45f373a2f880ac2fef1fb574d43a4f80e9f4181010b925059da21a0a994e895c01ba0eb";

    const jwtToken = jwt.sign(
      { id: user._id, isPremium: user.isPremium },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      token: jwtToken,
      user: {
        _id: user._id,
        email: user.email,
        profileCompleted: user.profileCompleted,
      },
    });
  } catch (err) {
    console.error("GOOGLE VERIFY ERROR:", err);
    res.status(401).json({ error: "GOOGLE_VERIFY_FAILED" });
  }
});


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
user: {
  _id: user._id,
  email: user.email,
  isPremium: user.isPremium,
  profileCompleted: user.profileCompleted, // 🔥
}
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
user: {
  _id: user._id,
  email: user.email,
  isPremium: user.isPremium,
  profileCompleted: user.profileCompleted, // 🔥
}
  });
});

router.get("/profile", async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "No token" });

    const JWT_SECRET = "d5f721491a7b51a3c83511efd6457e87729f100ee8f2c3191e4f4384c45f373a2f880ac2fef1fb574d43a4f80e9f4181010b925059da21a0a994e895c01ba0eb";
    const decoded = jwt.verify(token, JWT_SECRET);

    const user = await User.findById(decoded.id).select(
      "email isPremium age height weight profileCompleted weightUnit heightUnit gender"
    );

    res.json(user);
  } catch (e) {
    res.status(401).json({ error: "Invalid token" });
  }
});
router.put("/profile", async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "No token" });

    const JWT_SECRET = "d5f721491a7b51a3c83511efd6457e87729f100ee8f2c3191e4f4384c45f373a2f880ac2fef1fb574d43a4f80e9f4181010b925059da21a0a994e895c01ba0eb";
    const decoded = jwt.verify(token, JWT_SECRET);

const { age, height, weight, gender, weightUnit, heightUnit } = req.body;

const update = {
  age,
  height,
  weight,
  gender,
  weightUnit,
  heightUnit,
  profileCompleted: true,
};

// 🔥 Eğer kilo değiştiyse history’ye ekle
if (typeof weight === "number") {
  update.$push = {
    weightHistory: {
      value: weight, // kg
      date: new Date(),
    },
  };
}

const user = await User.findByIdAndUpdate(
  decoded.id,
  update,
  { new: true }
).select(
  "email age weight height gender weightUnit heightUnit weightHistory"
);

res.json(user);


  } catch (e) {
    res.status(401).json({ error: "Invalid token" });
  }
});
router.get("/profile/weight-history", async (req, res) => {
      const JWT_SECRET = "d5f721491a7b51a3c83511efd6457e87729f100ee8f2c3191e4f4384c45f373a2f880ac2fef1fb574d43a4f80e9f4181010b925059da21a0a994e895c01ba0eb";
  try {
    const token = req.headers.authorization?.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    const user = await User.findById(decoded.id).select(
      "weightHistory weightUnit"
    );

    res.json(user);
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
});

router.get("/test", (req, res) => {
  res.json({ ok: true, message: "Auth route çalışıyor" });
});


export const authRoute = router;
