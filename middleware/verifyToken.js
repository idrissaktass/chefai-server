import jwt from "jsonwebtoken";

export const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Token gerekli" });

  try {
    const decoded = jwt.verify(
      token,
      "d5f721491a7b51a3c83511efd6457e87729f100ee8f2c3191e4f4384c45f373a2f880ac2fef1fb574d43a4f80e9f4181010b925059da21a0a994e895c01ba0eb"
    );
    req.userId = decoded.id;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Token geçersiz" });
  }
};
