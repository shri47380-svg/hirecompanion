export type Candidate = {
  id: string;
  name: string;
  role: string;
  email: string;
  location: string;
  experience: string;
  stage: string;
  match: number | null;
  initials: string;
  color: string;
  skills: string[];
  lastActive: string;
};

export type CandidateRecord = {
  _id: string;
  name: string;
  email: string;
  role?: string;
  location?: string;
  experienceYears?: number;
  skills?: string[];
  stage?: string;
  matchScore?: number | null;
  jobTitle?: string;
  updatedAt?: string;
  createdAt?: string;
};

export type JobRecord = {
  _id: string;
  title: string;
  department?: string;
  location?: string;
  employmentType: "full-time" | "part-time" | "contract" | "internship";
  description: string;
  requiredSkills?: string[];
  preferredSkills?: string[];
  status: "draft" | "active" | "on-hold" | "closed";
  applicantCount?: number;
  updatedAt?: string;
};

export type InterviewRecord = {
  _id: string;
  scheduledAt: string;
  type: string;
  status: "scheduled" | "completed" | "cancelled";
  applicationId?: {
    candidateId?: { name?: string; role?: string };
    jobId?: { title?: string };
  } | null;
};

export type ApplicationRecord = {
  _id: string;
  candidateId?: { _id: string; name?: string; role?: string };
  jobId?: { _id: string; title?: string };
  stage: string;
};

export type ActivityRecord = {
  _id: string;
  summary: string;
  eventType: string;
  entityType: "candidate" | "job" | "application" | "interview" | "resume";
  createdAt: string;
  actorId?: { name?: string };
};

export type ResumeRecord = {
  _id: string;
  originalName: string;
  size: number;
  createdAt: string;
  candidateId?: { _id: string; name?: string } | string | null;
};

export type DashboardSummary = {
  candidates: number;
  openJobs: number;
  upcomingInterviews: number;
  pipeline: Array<{ _id: string; count: number }>;
  activityByDay: Array<{ day: string; count: number }>;
};

type ApiEnvelope<T> = { data: T };

const API_BASE_URL = import.meta.env.VITE_API_URL || "/api/v1";

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiRequest<T>(
  path: string,
  token: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const responseText = await response.text();
  let body: ApiEnvelope<T> | { error?: { message?: string } };
  try {
    body = JSON.parse(responseText) as ApiEnvelope<T> | { error?: { message?: string } };
  } catch {
    const message = response.ok
      ? "The server returned an invalid response."
      : `The API could not complete the request (${response.status}). Check that the backend and database are running.`;
    throw new ApiError(message, response.status);
  }
  if (!response.ok) {
    const message = "error" in body ? body.error?.message : undefined;
    throw new ApiError(message || `Request failed (${response.status}).`, response.status);
  }
  if (!("data" in body)) {
    throw new ApiError("The server returned an invalid response.", response.status);
  }
  return body.data;
}

export function apiUrl(path: string) {
  return `${API_BASE_URL}${path}`;
}
