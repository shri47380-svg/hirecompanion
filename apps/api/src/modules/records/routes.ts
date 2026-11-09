import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { HttpError } from "../../middleware/errors.js";
import { Activity, Application, Candidate, Interview, Job } from "../../models/index.js";

export const recordsRouter = Router();

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  page: z.coerce.number().int().min(1).default(1),
  search: z.string().trim().max(100).optional(),
  status: z.string().trim().max(30).optional(),
});

const candidateInput = z.object({
  name: z.string().trim().min(1).max(140),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().max(40).optional(),
  role: z.string().trim().max(140).optional(),
  location: z.string().trim().max(140).optional(),
  experienceYears: z.number().min(0).max(80).optional(),
  skills: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
  source: z.string().trim().max(100).optional(),
});

const jobInput = z.object({
  title: z.string().trim().min(1).max(160),
  department: z.string().trim().max(100).optional(),
  location: z.string().trim().max(140).optional(),
  employmentType: z.enum(["full-time", "part-time", "contract", "internship"]).optional(),
  description: z.string().trim().min(1).max(20000),
  requiredSkills: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
  preferredSkills: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
  status: z.enum(["draft", "active", "on-hold", "closed"]).optional(),
});

function scope(req: Express.Request) {
  return { organizationId: req.auth!.organizationId };
}

async function recordActivity(req: Express.Request, entityType: "candidate" | "job" | "application" | "interview", entityId: string, eventType: string, summary: string) {
  await Activity.create({ ...scope(req), actorId: req.auth!.userId, entityType, entityId, eventType, summary });
}

recordsRouter.get("/candidates", async (req, res) => {
  const query = listQuery.parse(req.query);
  const filter: Record<string, unknown> = { ...scope(req), archivedAt: null };
  if (query.search) filter.$text = { $search: query.search };
  const [items, total] = await Promise.all([
    Candidate.find(filter).sort({ updatedAt: -1, _id: -1 }).skip((query.page - 1) * query.limit).limit(query.limit).lean(),
    Candidate.countDocuments(filter),
  ]);
  const applications = items.length
    ? await Application.find({ ...scope(req), candidateId: { $in: items.map((item) => item._id) }, status: "active" })
      .sort({ updatedAt: -1 }).select("candidateId stage matchScore").lean()
    : [];
  const latestApplicationByCandidate = new Map<string, (typeof applications)[number]>();
  for (const application of applications) {
    const candidateId = application.candidateId.toString();
    if (!latestApplicationByCandidate.has(candidateId)) latestApplicationByCandidate.set(candidateId, application);
  }
  const data = items.map((candidate) => {
    const application = latestApplicationByCandidate.get(String(candidate._id));
    return { ...candidate, stage: application?.stage ?? "New", matchScore: application?.matchScore ?? null };
  });
  res.json({ data, pagination: { page: query.page, limit: query.limit, total, pages: Math.ceil(total / query.limit) } });
});

recordsRouter.post("/candidates", async (req, res) => {
  const body = candidateInput.parse(req.body);
  const candidate = await Candidate.create({ ...body, email: body.email.toLowerCase(), ...scope(req), createdBy: req.auth!.userId });
  await recordActivity(req, "candidate", candidate.id, "candidate.created", `Added candidate ${candidate.name}`);
  res.status(201).json({ data: candidate });
});

recordsRouter.get("/candidates/:id", async (req, res) => {
  const candidate = await Candidate.findOne({ _id: req.params.id, ...scope(req), archivedAt: null });
  if (!candidate) throw new HttpError(404, "CANDIDATE_NOT_FOUND", "Candidate not found.");
  res.json({ data: candidate });
});

recordsRouter.patch("/candidates/:id", async (req, res) => {
  const body = candidateInput.partial().parse(req.body);
  const candidate = await Candidate.findOneAndUpdate({ _id: req.params.id, ...scope(req), archivedAt: null }, body, { new: true, runValidators: true });
  if (!candidate) throw new HttpError(404, "CANDIDATE_NOT_FOUND", "Candidate not found.");
  await recordActivity(req, "candidate", candidate.id, "candidate.updated", `Updated candidate ${candidate.name}`);
  res.json({ data: candidate });
});

recordsRouter.get("/jobs", async (req, res) => {
  const query = listQuery.parse(req.query);
  const filter: Record<string, unknown> = { ...scope(req) };
  if (query.status) filter.status = query.status;
  if (query.search) filter.$text = { $search: query.search };
  const [items, total] = await Promise.all([
    Job.find(filter).sort({ updatedAt: -1, _id: -1 }).skip((query.page - 1) * query.limit).limit(query.limit).lean(),
    Job.countDocuments(filter),
  ]);
  const applicantCounts = items.length
    ? await Application.aggregate([
      { $match: { organizationId: new mongoose.Types.ObjectId(req.auth!.organizationId), status: "active", jobId: { $in: items.map((item) => item._id) } } },
      { $group: { _id: "$jobId", count: { $sum: 1 } } },
    ])
    : [];
  const countsByJob = new Map<string, number>(applicantCounts.map((entry: { _id: mongoose.Types.ObjectId; count: number }) => [entry._id.toString(), entry.count]));
  const data = items.map((job) => ({ ...job, applicantCount: countsByJob.get(String(job._id)) ?? 0 }));
  res.json({ data, pagination: { page: query.page, limit: query.limit, total, pages: Math.ceil(total / query.limit) } });
});

recordsRouter.post("/jobs", async (req, res) => {
  const body = jobInput.parse(req.body);
  const job = await Job.create({ ...body, ...scope(req), ownerId: req.auth!.userId });
  await recordActivity(req, "job", job.id, "job.created", `Created job ${job.title}`);
  res.status(201).json({ data: job });
});

recordsRouter.patch("/jobs/:id", async (req, res) => {
  const body = jobInput.partial().parse(req.body);
  const job = await Job.findOneAndUpdate({ _id: req.params.id, ...scope(req) }, body, { new: true, runValidators: true });
  if (!job) throw new HttpError(404, "JOB_NOT_FOUND", "Job not found.");
  await recordActivity(req, "job", job.id, "job.updated", `Updated job ${job.title}`);
  res.json({ data: job });
});

recordsRouter.post("/applications", async (req, res) => {
  const body = z.object({
    candidateId: z.string().regex(/^[a-f\d]{24}$/i),
    jobId: z.string().regex(/^[a-f\d]{24}$/i),
    stage: z.enum(["applied", "screening", "interview", "offer", "hired", "rejected"]).optional(),
    source: z.string().trim().max(100).optional(),
  }).parse(req.body);
  const [candidate, job] = await Promise.all([
    Candidate.exists({ _id: body.candidateId, ...scope(req), archivedAt: null }),
    Job.exists({ _id: body.jobId, ...scope(req) }),
  ]);
  if (!candidate || !job) throw new HttpError(404, "RELATED_RECORD_NOT_FOUND", "Candidate or job not found in this organization.");
  const application = await Application.create({ ...body, ...scope(req) });
  await recordActivity(req, "application", application.id, "application.created", "Created candidate application");
  res.status(201).json({ data: application });
});

recordsRouter.patch("/applications/:id/stage", async (req, res) => {
  const { stage } = z.object({ stage: z.enum(["applied", "screening", "interview", "offer", "hired", "rejected"]) }).parse(req.body);
  const application = await Application.findOneAndUpdate({ _id: req.params.id, ...scope(req) }, { stage }, { new: true, runValidators: true });
  if (!application) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found.");
  await recordActivity(req, "application", application.id, "application.stage_changed", `Moved application to ${stage}`);
  res.json({ data: application });
});

recordsRouter.get("/applications", async (req, res) => {
  const query = listQuery.parse(req.query);
  const filter: Record<string, unknown> = { ...scope(req) };
  if (query.status) filter.stage = query.status;
  const [items, total] = await Promise.all([
    Application.find(filter).sort({ updatedAt: -1 }).skip((query.page - 1) * query.limit).limit(query.limit)
      .populate("candidateId", "name email role location").populate("jobId", "title status").lean(),
    Application.countDocuments(filter),
  ]);
  res.json({ data: items, pagination: { page: query.page, limit: query.limit, total, pages: Math.ceil(total / query.limit) } });
});

recordsRouter.post("/interviews", async (req, res) => {
  const body = z.object({
    applicationId: z.string().regex(/^[a-f\d]{24}$/i),
    scheduledAt: z.coerce.date(),
    type: z.enum(["screening", "technical", "portfolio", "culture", "other"]).default("screening"),
    interviewerIds: z.array(z.string().regex(/^[a-f\d]{24}$/i)).max(20).default([]),
  }).parse(req.body);
  const application = await Application.exists({ _id: body.applicationId, ...scope(req) });
  if (!application) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found.");
  const interview = await Interview.create({ ...body, ...scope(req) });
  await recordActivity(req, "interview", interview.id, "interview.scheduled", "Scheduled an interview");
  res.status(201).json({ data: interview });
});

recordsRouter.get("/interviews", async (req, res) => {
  const query = listQuery.parse(req.query);
  const items = await Interview.find({ ...scope(req), scheduledAt: { $gte: new Date() } })
    .sort({ scheduledAt: 1 }).limit(query.limit)
    .populate({ path: "applicationId", populate: [{ path: "candidateId", select: "name role" }, { path: "jobId", select: "title" }] }).lean();
  res.json({ data: items });
});

recordsRouter.patch("/interviews/:id", async (req, res) => {
  const body = z.object({
    status: z.enum(["scheduled", "completed", "cancelled"]).optional(),
    feedback: z.string().trim().max(10000).optional(),
    rating: z.number().int().min(1).max(5).optional(),
  }).refine((value) => Object.keys(value).length > 0, "Provide at least one field to update").parse(req.body);
  const interview = await Interview.findOneAndUpdate({ _id: req.params.id, ...scope(req) }, body, { new: true, runValidators: true });
  if (!interview) throw new HttpError(404, "INTERVIEW_NOT_FOUND", "Interview not found.");
  await recordActivity(req, "interview", interview.id, "interview.updated", "Updated interview details");
  res.json({ data: interview });
});

recordsRouter.get("/activity", async (req, res) => {
  const query = listQuery.parse(req.query);
  const items = await Activity.find(scope(req)).sort({ createdAt: -1 }).limit(query.limit).populate("actorId", "name").lean();
  res.json({ data: items });
});

recordsRouter.get("/dashboard/summary", async (req, res) => {
  const organizationId = req.auth!.organizationId;
  const [candidateCount, activeJobs, applicationStages, upcomingInterviews, activityByDay] = await Promise.all([
    Candidate.countDocuments({ organizationId, archivedAt: null }),
    Job.countDocuments({ organizationId, status: "active" }),
    Application.aggregate([
      { $match: { organizationId: new mongoose.Types.ObjectId(organizationId), status: "active" } },
      { $group: { _id: "$stage", count: { $sum: 1 } } },
    ]),
    Interview.countDocuments({ organizationId, status: "scheduled", scheduledAt: { $gte: new Date(), $lt: new Date(Date.now() + 7 * 86400000) } }),
    Activity.aggregate([
      { $match: { organizationId: new mongoose.Types.ObjectId(organizationId), createdAt: { $gte: new Date(Date.now() - 13 * 86400000) } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
  ]);
  res.json({ data: { candidates: candidateCount, openJobs: activeJobs, upcomingInterviews, pipeline: applicationStages, activityByDay: activityByDay.map((item: { _id: string; count: number }) => ({ day: item._id, count: item.count })) } });
});
