import 'dotenv/config';
import { Router } from "express";
import { OAuth2Client } from "google-auth-library";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { User } from "../models/User.js";

const router = Router();

/* =====================================================
   🔐 GOOGLE OAUTH CONFIG (WEB CLIENT ONLY)
===================================================== */

const GOOGLE_WEB_CLIENT_ID =
  "737872217384-d4bjnk44e7uisim4sd8q9obf9kd9snor.apps.googleusercontent.com";

const GOOGLE_WEB_CLIENT_SECRET =
  process.env.GOOGLE_WEB_CLIENT_SECRET;

const GOOGLE_REDIRECT_URI =
  "https://chefai-server-1.onrender.com/api/auth/google/callback";

const oauth2Client = new OAuth2Client(
  GOOGLE_WEB_CLIENT_ID,
  GOOGLE_WEB_CLIENT_SECRET,
  // GOOGLE_REDIRECT_URI
);

/* =====================================================
   🚀 GOOGLE LOGIN START (APK bunu açar)
===================================================== */

router.get("/google/start", (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["profile", "email"],
    prompt: "consent",
    redirect_uri: GOOGLE_REDIRECT_URI,
    state: encodeURIComponent(
      "com.idrisaktas.chefai://login-callback"
    ),
  });

  res.redirect(url);
});


/* =====================================================
   🔁 GOOGLE CALLBACK (TOKEN EXCHANGE BURADA)
===================================================== */
router.get("/google/callback", async (req, res) => {
  try {
    const { code, state } = req.query;

    if (!code || !state) {
      return res.redirect("com.idrisaktas.chefai://login-callback?reason=ERROR_CODE");
    }

    const callbackRedirectUri =
      "https://chefai-server-1.onrender.com/api/auth/google/callback";

    /* 🔁 CODE → TOKEN */
    const { tokens } = await oauth2Client.getToken({
      code,
      redirect_uri: callbackRedirectUri,
    });

    oauth2Client.setCredentials(tokens);

    /* 🔐 ID TOKEN DOĞRULAMA */
    const ticket = await oauth2Client.verifyIdToken({
      idToken: tokens.id_token,
      audience: GOOGLE_WEB_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload?.email) {
      return res.redirect("com.idrisaktas.chefai://login-callback?reason=ERROR_CODE");
    }

    /* ❗ LOCAL vs GOOGLE ÇAKIŞMA KONTROLÜ */
    const localUser = await User.findOne({
      email: payload.email,
      authProvider: "local",
    });

    if (localUser) {
      return res.redirect(
        "com.idrisaktas.chefai://login-callback?reason=EMAIL_REGISTERED_WITH_PASSWORD"
      );
    }

    /* 🔎 GOOGLE USER BUL / OLUŞTUR */
    let user = await User.findOne({
      email: payload.email,
      authProvider: "google",
    });

    if (!user) {
      user = await User.create({
        email: payload.email,
        name: payload.name || "",
        authProvider: "google",
        profileCompleted: false,
        isPremium: false,
      });
    }

    /* 🔑 JWT */
    const jwtToken = jwt.sign(
      {
        id: user._id,
        isPremium: user.isPremium,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    /* 📲 APP’E GERİ DÖN */
    const appRedirect = decodeURIComponent(state);

    return res.redirect(
      `${appRedirect}?token=${jwtToken}`
    );
  } catch (err) {
    console.error("GOOGLE CALLBACK ERROR:", err);
    return res.redirect("com.idrisaktas.chefai://login-callback?reason=ERROR_CODE");
  }
});


router.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password)
      return res.status(400).json({ error: "FIELDS_REQUIRED" });

    const existing = await User.findOne({ email });
    if (existing)
      return res.status(409).json({ error: "EMAIL_EXISTS" });

    const hashed = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      email,
      password: hashed,
      profileCompleted: false,
    });
  const JWT_SECRET = "d5f721491a7b51a3c83511efd6457e87729f100ee8f2c3191e4f4384c45f373a2f880ac2fef1fb574d43a4f80e9f4181010b925059da21a0a994e895c01ba0eb"; // burada kendi gizli key’ini yaz

    const token = jwt.sign(
      { id: user._id, isPremium: user.isPremium },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      token,
      user: {
        _id: user._id,
        email: user.email,
        profileCompleted: user.profileCompleted,
      },
    });
  } catch (err) {
    console.error("REGISTER ERROR:", err);
    res.status(500).json({ error: "REGISTER_FAILED" });
  }
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
