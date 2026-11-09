import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { env } from "../../config/env.js";
import { HttpError } from "../../middleware/errors.js";
import { Organization, User } from "../../models/index.js";
import { requireAuth } from "../../middleware/auth.js";

export const authRouter = Router();

const registerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(128),
  organizationName: z.string().trim().min(2).max(140),
});

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(128),
});

function createAccessToken(user: { id: string; organizationId: string; role: string }) {
  return jwt.sign({ organizationId: user.organizationId, role: user.role }, env.JWT_SECRET, {
    subject: user.id,
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
    issuer: "talentpilot-api",
    audience: "talentpilot-web",
  });
}

authRouter.post("/register", async (req, res) => {
  const body = registerSchema.parse(req.body);
  const email = body.email.toLowerCase();
  if (await User.exists({ email })) throw new HttpError(409, "EMAIL_IN_USE", "An account with this email already exists.");
  const passwordHash = await bcrypt.hash(body.password, 12);
  const slugBase = body.organizationName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const slug = `${slugBase}-${crypto.randomUUID().slice(0, 8)}`;
  const organization = await Organization.create({ name: body.organizationName, slug });
  try {
    const user = await User.create({ name: body.name, email, passwordHash, organizationId: organization.id, role: "owner" });
    res.status(201).json({
      data: { accessToken: createAccessToken({ id: user.id, organizationId: organization.id, role: user.role }), user: { id: user.id, name: user.name, email: user.email, role: user.role, organizationId: organization.id } },
    });
  } catch (error) {
    await Organization.deleteOne({ _id: organization._id });
    throw error;
  }
});

authRouter.post("/login", async (req, res) => {
  const body = loginSchema.parse(req.body);
  const user = await User.findOne({ email: body.email.toLowerCase(), status: "active" }).select("+passwordHash");
  if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) {
    throw new HttpError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
  }
  res.json({
    data: { accessToken: createAccessToken({ id: user.id, organizationId: user.organizationId.toString(), role: user.role }), user: { id: user.id, name: user.name, email: user.email, role: user.role, organizationId: user.organizationId } },
  });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await User.findOne({ _id: req.auth!.userId, organizationId: req.auth!.organizationId, status: "active" }).select("name email role organizationId");
  if (!user) throw new HttpError(401, "ACCOUNT_UNAVAILABLE", "This account is unavailable.");
  res.json({ data: user });
});
