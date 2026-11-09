import "express-async-errors";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rateLimit } from "express-rate-limit";
import { env } from "./config/env.js";
import { requireAuth } from "./middleware/auth.js";
import { errorHandler, notFound } from "./middleware/errors.js";
import { authRouter } from "./modules/auth/routes.js";
import { recordsRouter } from "./modules/records/routes.js";
import { resumesRouter } from "./modules/resumes/routes.js";

const app = express();
let localMongoServer: MongoMemoryServer | undefined;
app.disable("x-powered-by");
app.use(helmet());
app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use("/api/v1/auth", rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: "draft-7", legacyHeaders: false }));
app.get("/api/v1/health", (_req, res) => res.json({ data: { status: "ok", timestamp: new Date().toISOString() } }));
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/resumes", requireAuth, resumesRouter);
app.use("/api/v1", requireAuth, recordsRouter);
app.use(notFound);
app.use(errorHandler);

async function start() {
  try {
    await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 3000 });
    console.info("Connected to configured MongoDB.");
  } catch (error) {
    const isLocalMongoUri = /^mongodb:\/\/(?:[^@/]+@)?(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(env.MONGODB_URI);
    if (env.NODE_ENV !== "development" || !isLocalMongoUri) {
      throw error;
    }

    await mongoose.disconnect();
    const dataPath = resolve(dirname(fileURLToPath(import.meta.url)), "../data/mongodb");
    await mkdir(dataPath, { recursive: true });
    console.warn("Local MongoDB is unavailable; starting persistent development MongoDB.");
    localMongoServer = await MongoMemoryServer.create({
      instance: { dbPath: dataPath, port: 27017, storageEngine: "wiredTiger" },
    });
    await mongoose.connect(localMongoServer.getUri("talentpilot"));
    console.info(`Persistent development database: ${dataPath}`);
  }

  const server = app.listen(env.PORT, () => {
    console.info(`TalentPilot API listening on port ${env.PORT}`);
  });
  const shutdown = async (signal: string) => {
    console.info(`${signal} received; shutting down`);
    server.close(async () => {
      await mongoose.disconnect();
      await localMongoServer?.stop();
      process.exit(0);
    });
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

start().catch((error: unknown) => {
  console.error("Failed to start TalentPilot API", error);
  process.exitCode = 1;
});
