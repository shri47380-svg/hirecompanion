import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { HttpError } from "../../middleware/errors.js";
import { Activity, Candidate, Resume } from "../../models/index.js";

export const resumesRouter = Router();

const maximumFileSize = 10 * 1024 * 1024;
const resumeDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../../../data/resumes");
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maximumFileSize, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (file.mimetype !== "application/pdf" || !file.originalname.toLowerCase().endsWith(".pdf")) {
      callback(new HttpError(400, "INVALID_RESUME_TYPE", "Only PDF resumes are supported."));
      return;
    }
    callback(null, true);
  },
});

function scope(req: Express.Request) {
  return { organizationId: req.auth!.organizationId };
}

resumesRouter.get("/", async (req, res) => {
  const items = await Resume.find(scope(req))
    .sort({ createdAt: -1 })
    .limit(100)
    .populate("candidateId", "name")
    .select("-storageName -uploadedBy -organizationId")
    .lean();
  res.json({ data: items });
});

resumesRouter.post("/", upload.single("resume"), async (req, res) => {
  const file = req.file;
  if (!file) throw new HttpError(400, "RESUME_REQUIRED", "Choose a PDF resume to upload.");
  if (file.buffer.length < 5 || file.buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new HttpError(400, "INVALID_RESUME_FILE", "The uploaded file is not a valid PDF.");
  }

  const body = z.object({
    candidateId: z.string().regex(/^[a-f\d]{24}$/i).optional().or(z.literal("")),
  }).parse(req.body);
  const candidateId = body.candidateId || undefined;
  if (candidateId && !(await Candidate.exists({ _id: candidateId, ...scope(req), archivedAt: null }))) {
    throw new HttpError(404, "CANDIDATE_NOT_FOUND", "Candidate not found in this organization.");
  }

  const storageName = `${randomUUID()}.pdf`;
  await mkdir(resumeDirectory, { recursive: true });
  const filePath = resolve(resumeDirectory, storageName);
  await writeFile(filePath, file.buffer, { flag: "wx" });
  let resumeId: string | undefined;
  try {
    const resume = await Resume.create({
      ...scope(req),
      candidateId: candidateId || null,
      originalName: file.originalname.replace(/[\\/]/g, "_").slice(0, 255),
      storageName,
      size: file.size,
      uploadedBy: req.auth!.userId,
    });
    resumeId = resume.id;
    await Activity.create({
      ...scope(req),
      actorId: req.auth!.userId,
      entityType: "resume",
      entityId: resume._id,
      eventType: "resume.uploaded",
      summary: `Uploaded resume ${resume.originalName}`,
      metadata: candidateId ? { candidateId } : {},
    });
    const populated = await resume.populate("candidateId", "name");
    res.status(201).json({
      data: {
        _id: populated.id,
        originalName: populated.originalName,
        size: populated.size,
        createdAt: populated.createdAt,
        candidateId: populated.candidateId,
      },
    });
  } catch (error) {
    if (resumeId) await Resume.deleteOne({ _id: resumeId, ...scope(req) });
    await unlink(filePath);
    throw error;
  }
});

resumesRouter.get("/:id/download", async (req, res, next) => {
  const resume = await Resume.findOne({ _id: req.params.id, ...scope(req) }).select("storageName originalName");
  if (!resume) throw new HttpError(404, "RESUME_NOT_FOUND", "Resume not found.");
  const filePath = resolve(resumeDirectory, resume.storageName);
  createReadStream(filePath)
    .on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        next(new HttpError(404, "RESUME_FILE_NOT_FOUND", "The stored resume file is unavailable."));
        return;
      }
      next(error);
    })
    .pipe(res.type("application/pdf").attachment(resume.originalName));
});

resumesRouter.delete("/:id", async (req, res) => {
  const resume = await Resume.findOneAndDelete({ _id: req.params.id, ...scope(req) }).select("storageName originalName");
  if (!resume) throw new HttpError(404, "RESUME_NOT_FOUND", "Resume not found.");
  try {
    await unlink(resolve(resumeDirectory, resume.storageName));
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  await Activity.create({
    ...scope(req),
    actorId: req.auth!.userId,
    entityType: "resume",
    entityId: resume._id,
    eventType: "resume.deleted",
    summary: `Deleted resume ${resume.originalName}`,
  });
  res.status(204).end();
});
