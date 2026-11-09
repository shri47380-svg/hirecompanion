import type { NextFunction, Request, Response } from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { env } from "../config/env.js";
import { User } from "../models/index.js";

export type AuthUser = { userId: string; organizationId: string; role: string };
declare global {
  namespace Express {
    interface Request { auth?: AuthUser }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Authentication is required." } });
    return;
  }

  let token: string | JwtPayload;
  try {
    token = jwt.verify(header.slice(7), env.JWT_SECRET);
  } catch {
    res.status(401).json({ error: { code: "INVALID_TOKEN", message: "The access token is invalid or expired." } });
    return;
  }

  if (typeof token === "string" || !("sub" in token) || typeof token.sub !== "string" ||
      typeof token.organizationId !== "string" || typeof token.role !== "string") {
    res.status(401).json({ error: { code: "INVALID_TOKEN", message: "The access token is invalid." } });
    return;
  }

  const user = await User.findOne({
    _id: token.sub,
    organizationId: token.organizationId,
    status: "active",
  }).select("organizationId role");
  if (!user) {
    res.status(401).json({ error: { code: "ACCOUNT_UNAVAILABLE", message: "This account is unavailable." } });
    return;
  }

  req.auth = { userId: token.sub, organizationId: user.organizationId.toString(), role: user.role };
  next();
}
