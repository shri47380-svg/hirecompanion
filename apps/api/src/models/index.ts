import mongoose, { Schema, type InferSchemaType } from "mongoose";

const options = { timestamps: true, versionKey: false } as const;

const userSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  email: { type: String, required: true, lowercase: true, trim: true, unique: true, index: true },
  passwordHash: { type: String, required: true, select: false },
  organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
  role: { type: String, enum: ["owner", "admin", "recruiter", "viewer"], default: "owner" },
  status: { type: String, enum: ["active", "disabled"], default: "active" },
}, options);

const organizationSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 140 },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
}, options);

const candidateSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 140 },
  email: { type: String, required: true, lowercase: true, trim: true },
  phone: { type: String, trim: true, maxlength: 40 },
  role: { type: String, trim: true, maxlength: 140 },
  location: { type: String, trim: true, maxlength: 140 },
  experienceYears: { type: Number, min: 0, max: 80 },
  skills: { type: [String], default: [] },
  tags: { type: [String], default: [] },
  source: { type: String, trim: true, maxlength: 100 },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  archivedAt: { type: Date, default: null },
}, options);
candidateSchema.index({ organizationId: 1, email: 1 }, { unique: true });
candidateSchema.index({ organizationId: 1, updatedAt: -1 });
candidateSchema.index({ organizationId: 1, name: "text", role: "text", skills: "text" });

const jobSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 160 },
  department: { type: String, trim: true, maxlength: 100 },
  location: { type: String, trim: true, maxlength: 140 },
  employmentType: { type: String, enum: ["full-time", "part-time", "contract", "internship"], default: "full-time" },
  description: { type: String, required: true, maxlength: 20000 },
  requiredSkills: { type: [String], default: [] },
  preferredSkills: { type: [String], default: [] },
  status: { type: String, enum: ["draft", "active", "on-hold", "closed"], default: "draft", index: true },
  ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, options);
jobSchema.index({ organizationId: 1, status: 1, updatedAt: -1 });
jobSchema.index({ organizationId: 1, title: "text", description: "text", requiredSkills: "text" });

const applicationSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
  candidateId: { type: Schema.Types.ObjectId, ref: "Candidate", required: true },
  jobId: { type: Schema.Types.ObjectId, ref: "Job", required: true },
  stage: { type: String, enum: ["applied", "screening", "interview", "offer", "hired", "rejected"], default: "applied", index: true },
  status: { type: String, enum: ["active", "withdrawn", "archived"], default: "active" },
  source: { type: String, trim: true, maxlength: 100 },
  assignedTo: { type: Schema.Types.ObjectId, ref: "User" },
  matchScore: { type: Number, min: 0, max: 100 },
}, options);
applicationSchema.index({ organizationId: 1, candidateId: 1, jobId: 1 }, { unique: true });
applicationSchema.index({ organizationId: 1, jobId: 1, stage: 1 });

const interviewSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
  applicationId: { type: Schema.Types.ObjectId, ref: "Application", required: true, index: true },
  scheduledAt: { type: Date, required: true, index: true },
  type: { type: String, enum: ["screening", "technical", "portfolio", "culture", "other"], default: "screening" },
  status: { type: String, enum: ["scheduled", "completed", "cancelled"], default: "scheduled" },
  interviewerIds: [{ type: Schema.Types.ObjectId, ref: "User" }],
  feedback: { type: String, maxlength: 10000 },
  rating: { type: Number, min: 1, max: 5 },
}, options);
interviewSchema.index({ organizationId: 1, scheduledAt: 1, status: 1 });

const activitySchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
  actorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  entityType: { type: String, enum: ["candidate", "job", "application", "interview", "resume"], required: true },
  entityId: { type: Schema.Types.ObjectId, required: true },
  eventType: { type: String, required: true, maxlength: 100 },
  summary: { type: String, required: true, maxlength: 500 },
  metadata: { type: Schema.Types.Mixed, default: {} },
}, { ...options, versionKey: false });
activitySchema.index({ organizationId: 1, entityType: 1, entityId: 1, createdAt: -1 });

const resumeSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
  candidateId: { type: Schema.Types.ObjectId, ref: "Candidate", default: null },
  originalName: { type: String, required: true, maxlength: 255 },
  storageName: { type: String, required: true, unique: true },
  size: { type: Number, required: true, min: 1, max: 10 * 1024 * 1024 },
  uploadedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, options);
resumeSchema.index({ organizationId: 1, createdAt: -1 });
resumeSchema.index({ organizationId: 1, candidateId: 1, createdAt: -1 });

export const User = mongoose.models.User ?? mongoose.model("User", userSchema);
export const Organization = mongoose.models.Organization ?? mongoose.model("Organization", organizationSchema);
export const Candidate = mongoose.models.Candidate ?? mongoose.model("Candidate", candidateSchema);
export const Job = mongoose.models.Job ?? mongoose.model("Job", jobSchema);
export const Application = mongoose.models.Application ?? mongoose.model("Application", applicationSchema);
export const Interview = mongoose.models.Interview ?? mongoose.model("Interview", interviewSchema);
export const Activity = mongoose.models.Activity ?? mongoose.model("Activity", activitySchema);
export const Resume = mongoose.models.Resume ?? mongoose.model("Resume", resumeSchema);
export type CandidateRecord = InferSchemaType<typeof candidateSchema>;
