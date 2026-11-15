import { Router } from "express";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { JWT_SECRET } from "../config.js";
import { sql } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../lib/validate.js";

const router = Router();
const passwordSchema = z
  .string()
  .min(10)
  .regex(/[A-Za-z]/, "must contain at least one letter")
  .regex(/[0-9]/, "must contain at least one number");
const registerSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().email().transform((email) => email.toLowerCase()),
  password: passwordSchema,
});
const loginSchema = z.object({
  email: z.string().trim().email().transform((email) => email.toLowerCase()),
  password: z.string().min(1),
});

router.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    handler(req, res) {
      res.status(429).json({
        error: { message: "Too many authentication requests; try again later" },
      });
    },
  }),
);

router.post("/register", validate(registerSchema), async (req, res) => {
  const { name, email, password } = req.body;
  const passwordHash = await bcrypt.hash(password, 12);

  try {
    const [user] = await sql`
      INSERT INTO users (name, email, password_hash)
      VALUES (${name}, ${email}, ${passwordHash})
      RETURNING id, name, email, created_at
    `;

    const token = jwt.sign({ sub: user.id }, JWT_SECRET, {
      expiresIn: "1h",
      algorithm: "HS256",
    });

    return res.status(201).json({ user, token });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        error: { message: "An account with this email already exists" },
      });
    }

    throw error;
  }
});

router.post("/login", validate(loginSchema), async (req, res) => {
  const { email, password } = req.body;
  const [user] = await sql`
    SELECT id, name, email, password_hash, created_at
    FROM users
    WHERE email = ${email}
    LIMIT 1
  `;

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({
      error: { message: "Invalid email or password" },
    });
  }

  const token = jwt.sign({ sub: user.id }, JWT_SECRET, {
    expiresIn: "1h",
    algorithm: "HS256",
  });
  const { password_hash, ...safeUser } = user;

  return res.json({ token, user: safeUser });
});

router.get("/me", requireAuth, async (req, res) => {
  const [user] = await sql`
    SELECT id, name, email, created_at
    FROM users
    WHERE id = ${req.user.id}
    LIMIT 1
  `;

  if (!user) {
    res.set("WWW-Authenticate", 'Bearer realm="api", error="invalid_token"');
    return res.status(401).json({
      error: { message: "Invalid or expired token" },
    });
  }

  return res.json({ user });
});

export default router;
