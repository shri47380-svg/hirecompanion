# HireCompanion

A recruitment CRM built with React, Tailwind CSS, Express, MongoDB, and JWT authentication.

## What’s included

- Recruiter workspace UI with dashboard analytics, candidate search/filtering, job listings, interview tracking, candidate profiles, a filterable activity timeline, and hiring reports with CSV export.
- Express API with tenant-scoped authentication, organization registration, candidate/job/application/interview CRUD workflows, activity events, and dashboard aggregation.
- Mongoose models and indexes for organizations, users, candidates, jobs, applications, interviews, and activity.
- Request validation, centralized errors, rate limiting for authentication, security headers, CORS allowlisting, and API health endpoint.

The web app reads organization-scoped candidates, jobs, interviews, activity, and dashboard summaries from the API. Candidate and job creation are persisted through the API. Dashboard data refreshes every 15 seconds. Reports summarize the current pipeline and jobs and can be exported as CSV. The API requires a persistent MongoDB instance; it does not silently substitute an in-memory database. PDF resumes can be uploaded, associated with a candidate, and downloaded; files and metadata are stored locally. Resume text extraction is not included.

## Requirements

- Node.js 20+
- MongoDB 7+ (local or hosted)

## Run locally

1. For persistent local data, the API can start its own MongoDB process automatically in development. It stores database files in the ignored `apps/api/data/mongodb` directory. The first run downloads the MongoDB server binary. Alternatively, start your own MongoDB or use MongoDB Atlas:

   ```sh
   docker compose up -d mongodb
   ```

2. Copy `apps/api/.env.example` to `apps/api/.env`. Set `MONGODB_URI` to your MongoDB connection string and replace `JWT_SECRET` with a random secret of at least 32 characters. If the local URI is unavailable in development, the API starts the persistent local MongoDB automatically.
3. From the repository root, install dependencies and start both apps:

   ```sh
   npm install
   npm run dev
   ```

4. Open `http://localhost:5173`. The API listens at `http://localhost:4000`; Vite proxies `/api` requests to it.

The development MongoDB files survive app restarts and are not committed. To use MongoDB Atlas or another persistent database instead, set its URI in `apps/api/.env`; remote database connection failures are reported rather than silently replaced with local data.

Build both workspaces with `npm run build`.

## Deploy a shareable demo

The repository includes deployment configuration for Vercel (web app) and Render (API). A hosted MongoDB database is also required; create a MongoDB Atlas database and use its connection string for `MONGODB_URI`. Do not use the development-only local MongoDB fallback in production.

1. Push this repository to a Git provider.
2. In Render, create a Blueprint from the repository using `render.yaml`. Set `MONGODB_URI` to the Atlas connection string. Set `WEB_ORIGIN` to a temporary valid URL for the first deployment; update it to the final Vercel URL after deploying the web app.
3. In Vercel, import the repository with the repository root as the project root. Add the build environment variable `VITE_API_URL` with the Render service URL followed by `/api/v1` (for example, `https://your-api.onrender.com/api/v1`), then deploy.
4. Copy the Vercel URL into the Render service's `WEB_ORIGIN` environment variable and redeploy the API. The Vercel URL is the shareable link.

This Render configuration uses its free plan for a demo. Render's free service may sleep when idle, and files saved on its local filesystem—including uploaded resumes—are not durable across service restarts or redeployments. Use a paid persistent disk or move resume storage to private object storage before relying on resume uploads. Hosting and database accounts, their configuration, and any paid services must be provided by the project owner; this repository cannot publish itself.

## Resume storage

The API accepts PDF files up to 10 MB. Files are stored under the ignored `apps/api/data/resumes` directory, while organization-scoped metadata is stored in MongoDB. Back up both locations together. For production, replace local file storage with private object storage and malware scanning before accepting uploads from untrusted users.

## API outline

All routes are under `/api/v1`. Auth routes are public; all other routes require `Authorization: Bearer <access-token>`.

| Method | Route | Description |
|---|---|---|
| POST | `/auth/register` | Create an organization and its owner account |
| POST | `/auth/login` | Authenticate and issue an access token |
| GET | `/auth/me` | Get the authenticated user |
| GET / POST | `/candidates` | List or add candidates |
| GET / PATCH | `/candidates/:id` | Read or update a candidate |
| GET / POST | `/jobs` | List or create jobs |
| PATCH | `/jobs/:id` | Update a job |
| GET / POST | `/applications` | List or create candidate/job applications |
| PATCH | `/applications/:id/stage` | Move an application through the pipeline |
| GET / POST | `/interviews` | List upcoming or schedule interviews |
| PATCH | `/interviews/:id` | Update interview status/feedback |
| GET | `/activity` | Read latest organization activity |
| GET | `/dashboard/summary` | Get candidate, job, interview, and stage counts |
| GET / POST | `/resumes` | List or upload organization-scoped PDF resumes |
| GET | `/resumes/:id/download` | Download a stored resume |
| DELETE | `/resumes/:id` | Delete a stored resume |
| GET | `/health` | API liveness check |

## Production follow-up

Before production, add refresh-token rotation and secure cookie sessions, email verification/password recovery, private object storage with signed uploads and malware scanning, asynchronous resume parsing and AI jobs, provider usage controls, audit/event retention policies, automated tenant-isolation tests, and deployment/backup/observability configuration. A hosting account, production database, domain, and provider credentials must be provisioned by the project owner; the local development setup cannot publish itself to an external service.
