import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Activity, ArrowRight, Bell,
  BriefcaseBusiness, CalendarDays, Check, ChevronDown, Download,
  ChevronRight, CircleHelp, Clock3, FileText, LayoutDashboard,
  ListFilter, MessageSquareText, MoreHorizontal, Plus, Search,
  Settings2, Sparkles, Upload, Users, X,
} from "lucide-react";
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis,
} from "recharts";
import { type ActivityRecord, type ApplicationRecord, apiRequest, apiUrl, ApiError, type Candidate, type CandidateRecord, type DashboardSummary, type InterviewRecord, type JobRecord, type ResumeRecord } from "./api";

type View = "Overview" | "Candidates" | "Jobs" | "Interviews" | "Activity" | "Reports";

const navItems: { label: View; icon: typeof LayoutDashboard }[] = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "Candidates", icon: Users },
  { label: "Jobs", icon: BriefcaseBusiness },
  { label: "Interviews", icon: CalendarDays },
];

function Avatar({ candidate, size = "md" }: { candidate: Pick<Candidate, "initials" | "color">; size?: "sm" | "md" | "lg" }) {
  return <div className={`avatar avatar-${candidate.color} avatar-${size}`}>{candidate.initials}</div>;
}

const avatarColors = ["coral", "lavender", "sage", "yellow", "blue", "pink", "orange", "mint"];

function mapCandidate(record: CandidateRecord): Candidate {
  const initials = record.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const colorIndex = [...record._id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % avatarColors.length;
  const updated = record.updatedAt ? new Date(record.updatedAt) : null;
  const age = updated && !Number.isNaN(updated.getTime()) ? Date.now() - updated.getTime() : null;
  const relative = age === null ? "—" : age < 60_000 ? "Just now" : new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(
    -Math.floor(age / (age < 3_600_000 ? 60_000 : age < 86_400_000 ? 3_600_000 : 86_400_000)),
    age < 3_600_000 ? "minute" : age < 86_400_000 ? "hour" : "day",
  );
  return {
    id: record._id,
    name: record.name,
    role: record.role || record.jobTitle || "Role not specified",
    email: record.email,
    location: record.location || "Location not specified",
    experience: typeof record.experienceYears === "number" ? `${record.experienceYears} years` : "Not specified",
    stage: record.stage || "New",
    match: typeof record.matchScore === "number" ? record.matchScore : null,
    initials: initials || "?",
    color: avatarColors[colorIndex],
    skills: record.skills || [],
    lastActive: relative,
  };
}

function getApiErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Could not load data from the server.";
}

function formatFileSize(size: number) {
  return size >= 1024 * 1024 ? `${(size / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;
}

type AuthMode = "login" | "signup";

type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  organizationId: string;
};

function App() {
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(() => {
    if (typeof window === "undefined") return null;
    const item = window.localStorage.getItem("talentpilot-user");
    if (!item) return null;
    try {
      return JSON.parse(item) as SessionUser;
    } catch {
      window.localStorage.removeItem("talentpilot-user");
      window.localStorage.removeItem("talentpilot-token");
      return null;
    }
  });
  const [token, setToken] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem("talentpilot-token");
  });

  const onAuthenticated = (nextToken: string, user: SessionUser) => {
    setToken(nextToken);
    setSessionUser(user);
    window.localStorage.setItem("talentpilot-token", nextToken);
    window.localStorage.setItem("talentpilot-user", JSON.stringify(user));
  };

  const onLogout = () => {
    setToken(null);
    setSessionUser(null);
    window.localStorage.removeItem("talentpilot-token");
    window.localStorage.removeItem("talentpilot-user");
  };

  if (!token || !sessionUser) {
    return <AuthScreen mode={authMode} onModeChange={setAuthMode} onAuthenticated={onAuthenticated} />;
  }

  return <DashboardApp user={sessionUser} onLogout={onLogout} />;
}

function DashboardApp({ user, onLogout }: { user: SessionUser; onLogout: () => void }) {
  const [token] = useState(() => window.localStorage.getItem("talentpilot-token") || "");
  const [view, setView] = useState<View>("Overview");
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState("All stages");
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [toast, setToast] = useState("");
  const [candidateRecords, setCandidateRecords] = useState<CandidateRecord[]>([]);
  const [jobRecords, setJobRecords] = useState<JobRecord[]>([]);
  const [interviews, setInterviews] = useState<InterviewRecord[]>([]);
  const [resumes, setResumes] = useState<ResumeRecord[]>([]);
  const [activities, setActivities] = useState<ActivityRecord[]>([]);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [dataError, setDataError] = useState("");
  const [loading, setLoading] = useState(true);
  const candidates = useMemo(() => candidateRecords.map(mapCandidate), [candidateRecords]);
  const filteredCandidates = useMemo(() => candidates.filter((candidate) => {
    const matchesQuery = `${candidate.name} ${candidate.role} ${candidate.location}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (stage === "All stages" || candidate.stage === stage);
  }), [candidates, query, stage]);

  const refreshData = useCallback(async () => {
    try {
      const [nextCandidates, nextJobs, nextInterviews, nextActivities, nextSummary, nextResumes] = await Promise.all([
        apiRequest<CandidateRecord[]>("/candidates?limit=100", token),
        apiRequest<JobRecord[]>("/jobs?limit=100", token),
        apiRequest<InterviewRecord[]>("/interviews?limit=100", token),
        apiRequest<ActivityRecord[]>("/activity?limit=100", token),
        apiRequest<DashboardSummary>("/dashboard/summary", token),
        apiRequest<ResumeRecord[]>("/resumes", token),
      ]);
      setCandidateRecords(nextCandidates);
      setJobRecords(nextJobs);
      setInterviews(nextInterviews);
      setActivities(nextActivities);
      setSummary(nextSummary);
      setResumes(nextResumes);
      setDataError("");
      setLoading(false);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onLogout();
        return;
      }
      setCandidateRecords([]);
      setJobRecords([]);
      setInterviews([]);
      setActivities([]);
      setSummary(null);
      setResumes([]);
      setDataError(getApiErrorMessage(error));
      setLoading(false);
    }
  }, [onLogout, token]);

  useEffect(() => {
    void refreshData();
    const timer = window.setInterval(() => void refreshData(), 15_000);
    return () => window.clearInterval(timer);
  }, [refreshData]);

  const notify = (text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(""), 2600);
  };

  const uploadResume = async (file: File, candidateId?: string) => {
    const formData = new FormData();
    formData.set("resume", file);
    if (candidateId) formData.set("candidateId", candidateId);
    try {
      await apiRequest<ResumeRecord>("/resumes", token, { method: "POST", body: formData });
      await refreshData();
      notify("Resume uploaded and saved.");
    } catch (error) {
      notify(getApiErrorMessage(error));
    }
  };

  const downloadResume = async (resume: ResumeRecord) => {
    try {
      const response = await fetch(apiUrl(`/resumes/${resume._id}/download`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const body = await response.json() as { error?: { message?: string } };
        throw new ApiError(body.error?.message || `Download failed (${response.status}).`, response.status);
      }
      const objectUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = resume.originalName;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (error) {
      notify(getApiErrorMessage(error));
    }
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Sparkles size={17} strokeWidth={2.6} /></div>
          <span>HireCompanion</span>
        </div>
        <button className="workspace-switcher">
          <span className="workspace-logo">{user.name.slice(0, 1).toUpperCase()}</span>
          <span className="workspace-copy"><strong>Your workspace</strong><small>{user.name}'s team</small></span>
          <ChevronDown size={15} />
        </button>
        <div className="nav-label">WORKSPACE</div>
        <nav className="main-nav">
          {navItems.map(({ label, icon: Icon }) => (
            <button key={label} onClick={() => setView(label)} className={`nav-item ${view === label ? "active" : ""}`}>
              <Icon size={17} strokeWidth={1.8} /><span>{label}</span>
              {label === "Candidates" && <span className="nav-count">{summary ? summary.candidates : "—"}</span>}
            </button>
          ))}
        </nav>
        <div className="nav-label tools-label">TOOLS</div>
        <nav className="main-nav">
          <button className={`nav-item ${view === "Activity" ? "active" : ""}`} onClick={() => setView("Activity")}><Activity size={17} /><span>Activity</span></button>
          <button className={`nav-item ${view === "Reports" ? "active" : ""}`} onClick={() => setView("Reports")}><FileText size={17} /><span>Reports</span></button>
        </nav>
        <div className="sidebar-bottom">
          <button className="nav-item" onClick={() => notify("Help center opened in a new tab")}><CircleHelp size={17} /><span>Help center</span></button>
          <button className="nav-item" onClick={() => notify("Settings are coming soon")}><Settings2 size={17} /><span>Settings</span></button>
          <div className="sidebar-profile">
            <div className="profile-avatar">{user.name.slice(0, 2).toUpperCase()}</div>
            <div className="profile-copy"><strong>{user.name}</strong><small>{user.email}</small></div>
            <button className="text-link sign-out-link" onClick={onLogout}>Log out</button>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb"><span>Workspace</span><ChevronRight size={14} /><strong>{view}</strong></div>
          <div className="topbar-actions">
            <div className="search-wrap"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search anything..." /><kbd>⌘ K</kbd></div>
            <button className="icon-button notification-button" aria-label="Notifications" onClick={() => notify("You’re all caught up")}><Bell size={18} /><i /></button>
            <button className="help-button" onClick={() => notify("Help center opened in a new tab")}><CircleHelp size={17} /></button>
          </div>
        </header>

        <div className="page-wrap">
          {dataError && <div className="data-error" role="alert"><strong>Live data is unavailable.</strong> {dataError} <button className="text-link" onClick={() => void refreshData()}>Retry</button></div>}
          {view === "Overview" && <Overview user={user} candidates={candidates} activities={activities} resumes={resumes} summary={summary} loading={loading} onView={setView} onUpload={uploadResume} onDownload={downloadResume} />}
          {view === "Candidates" && <CandidatesPage filtered={filteredCandidates} query={query} setQuery={setQuery} stage={stage} setStage={setStage} onSelect={setSelected} onCreated={(record) => { setCandidateRecords((current) => [record, ...current]); void refreshData(); notify("Candidate saved."); }} token={token} loading={loading} dataUnavailable={Boolean(dataError)} />}
          {view === "Jobs" && <JobsPage jobs={jobRecords} token={token} onCreated={(record) => { setJobRecords((current) => [record, ...current]); void refreshData(); }} onNotify={notify} loading={loading} dataUnavailable={Boolean(dataError)} />}
          {view === "Interviews" && <InterviewsPage interviews={interviews} token={token} loading={loading} onCreated={() => void refreshData()} onNotify={notify} dataUnavailable={Boolean(dataError)} />}
          {view === "Activity" && <ActivityPage activities={activities} loading={loading} dataUnavailable={Boolean(dataError)} onRefresh={() => void refreshData()} />}
          {view === "Reports" && <ReportsPage summary={summary} jobs={jobRecords} loading={loading} dataUnavailable={Boolean(dataError)} onNotify={notify} />}
        </div>
      </main>
      {selected && <CandidateDrawer candidate={selected} jobs={jobRecords} resumes={resumes} token={token} onClose={() => setSelected(null)} onNotify={notify} onUpload={uploadResume} onDownload={downloadResume} onApplicationCreated={() => { setSelected(null); void refreshData(); notify("Application saved."); }} />}
      {toast && <div className="toast"><Check size={16} />{toast}</div>}
    </div>
  );
}

function AuthScreen({ mode, onModeChange, onAuthenticated }: { mode: AuthMode; onModeChange: (nextMode: AuthMode) => void; onAuthenticated: (token: string, user: SessionUser) => void; }) {
  const isLogin = mode === "login";
  const [name, setName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const url = apiUrl(`/auth/${isLogin ? "login" : "register"}`);
      const payload = isLogin
        ? { email, password }
        : { name, email, password, organizationName };

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await response.json();
      if (!response.ok) {
        throw new Error(json?.error?.message || json?.message || "Authentication failed.");
      }

      const accessToken = json?.data?.accessToken as string | undefined;
      const user = json?.data?.user as SessionUser | undefined;
      if (!accessToken || !user) {
        throw new Error("The server response did not include a valid session.");
      }

      onAuthenticated(accessToken, user);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to sign in right now.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-shell">
        <div className="auth-brand">
          <div className="brand-mark"><Sparkles size={17} strokeWidth={2.6} /></div>
          <span>HireCompanion</span>
        </div>

        <div className="auth-card panel">
          <div className="auth-toggle">
            <button className={isLogin ? "active" : ""} onClick={() => onModeChange("login")} type="button">Sign in</button>
            <button className={!isLogin ? "active" : ""} onClick={() => onModeChange("signup")} type="button">Create account</button>
          </div>

          <div className="auth-copy">
            <h1>{isLogin ? "Welcome back" : "Create your workspace"}</h1>
            <p>{isLogin ? "Sign in to continue hiring faster." : "Set up your recruitment workspace and team access."}</p>
          </div>

          <form className="auth-form" onSubmit={handleSubmit}>
            {!isLogin && (
              <label>
                <span>Full name</span>
                <input type="text" value={name} onChange={(event) => setName(event.target.value)} placeholder="Sarah Chen" required />
              </label>
            )}

            {!isLogin && (
              <label>
                <span>Organization name</span>
                <input type="text" value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} placeholder="Northstar Studio" required />
              </label>
            )}

            <label>
              <span>Email</span>
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" required />
            </label>

            <label>
              <span>Password</span>
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={isLogin ? "Enter your password" : "At least 12 characters"} minLength={isLogin ? 1 : 12} required />
            </label>

            {error && <div className="auth-error">{error}</div>}

            <button className="button button-primary auth-submit" type="submit" disabled={loading}>
              {loading ? (isLogin ? "Signing in..." : "Creating account...") : (isLogin ? "Sign in" : "Create account")}
            </button>
          </form>

          <div className="auth-footer">
            {isLogin ? "Need an account?" : "Already have an account?"} <button type="button" onClick={() => onModeChange(isLogin ? "signup" : "login")}>{isLogin ? "Create one" : "Sign in"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Overview({ user, candidates, activities, resumes, summary, loading, onView, onUpload, onDownload }: {
  user: SessionUser;
  candidates: Candidate[];
  activities: ActivityRecord[];
  resumes: ResumeRecord[];
  summary: DashboardSummary | null;
  loading: boolean;
  onView: (view: View) => void;
  onUpload: (file: File, candidateId?: string) => Promise<void>;
  onDownload: (resume: ResumeRecord) => Promise<void>;
}) {
  const resumeInput = useRef<HTMLInputElement>(null);
  const [uploadingResume, setUploadingResume] = useState(false);
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const activityLookup = new Map((summary?.activityByDay || []).map((item) => [item.day, item.count]));
  const dayKey = (date: Date) => date.toISOString().slice(0, 10);
  const chartData = summary ? Array.from({ length: 14 }, (_, index) => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - (13 - index));
    const day = dayKey(date);
    return {
      day: date.toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" }),
      thisWeek: index >= 7 ? activityLookup.get(day) || 0 : 0,
      lastWeek: index < 7 ? activityLookup.get(day) || 0 : 0,
    };
  }) : [];
  const stageColors: Record<string, string> = {
    applied: "bar-dark", screening: "bar-green", interview: "bar-mint",
    offer: "bar-yellow", hired: "bar-blue", rejected: "bar-dark",
  };
  const pipeline = summary?.pipeline || [];
  const maximumStageCount = Math.max(1, ...pipeline.map((stage) => stage.count));
  return (
    <>
      <section className="welcome-row">
        <div><div className="eyebrow">{now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }).toUpperCase()}</div><h1>{greeting}, {user.name.split(" ")[0]} <span className="wave">✦</span></h1><p>Live hiring data for your organization.</p></div>
        <div className="welcome-actions">
          <input ref={resumeInput} type="file" accept=".pdf,application/pdf" hidden onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) {
              setUploadingResume(true);
              void onUpload(file).finally(() => setUploadingResume(false));
            }
          }} />
          <button className="button button-secondary" onClick={() => resumeInput.current?.click()} disabled={uploadingResume}>
            <Upload size={15} /> {uploadingResume ? "Uploading..." : "Upload resume"}
          </button>
          <button className="button button-primary" onClick={() => onView("Jobs")}><Plus size={16} /> Create a job</button>
        </div>
      </section>

      <section className="stats-grid">
        <StatCard label="Candidates" value={loading || !summary ? "—" : String(summary.candidates)} caption="In your organization" icon={<Users size={17} />} />
        <StatCard label="Open positions" value={loading || !summary ? "—" : String(summary.openJobs)} caption="Active job listings" icon={<BriefcaseBusiness size={17} />} />
        <StatCard label="Upcoming interviews" value={loading || !summary ? "—" : String(summary.upcomingInterviews)} caption="Next 7 days" icon={<CalendarDays size={17} />} />
        <StatCard label="Applications" value={loading || !summary ? "—" : String(pipeline.reduce((total, item) => total + item.count, 0))} caption="Active pipeline" icon={<Clock3 size={17} />} />
      </section>

      <section className="content-grid">
        <div className="panel pipeline-panel">
          <div className="panel-heading">
            <div><h2>Hiring activity</h2><p>Recorded updates from the last 14 days</p></div>
            <span className="select-button">Last 14 days</span>
          </div>
          <div className="chart-legend"><span><i className="legend-dot green-dot" />Last 7 days</span><span><i className="legend-dot gray-dot" />Previous 7 days</span></div>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 4, left: -24, bottom: 0 }}>
                <defs>
                  <linearGradient id="greenFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#39a77b" stopOpacity={0.17} /><stop offset="100%" stopColor="#39a77b" stopOpacity={0} /></linearGradient>
                  <linearGradient id="grayFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#bac4bf" stopOpacity={0.13} /><stop offset="100%" stopColor="#bac4bf" stopOpacity={0} /></linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="#edf0ee" />
                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: "#98a19c", fontSize: 11 }} dy={10} />
                <Tooltip contentStyle={{ border: "1px solid #e8edea", borderRadius: 10, fontSize: 12, boxShadow: "0 6px 20px #19231b12" }} />
                <Area type="monotone" dataKey="lastWeek" stroke="#c5ceca" strokeWidth={2} fill="url(#grayFill)" />
                <Area type="monotone" dataKey="thisWeek" stroke="#27936a" strokeWidth={2.5} fill="url(#greenFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="chart-footnote"><span><Activity size={14} /> Counts come from saved activity records</span><span>Refreshes every 15 seconds</span></div>
        </div>

        <div className="panel pipeline-breakdown">
          <div className="panel-heading"><div><h2>Pipeline overview</h2><p>Across all open positions</p></div><button className="more-button" aria-label="More options"><MoreHorizontal size={19} /></button></div>
          <div className="pipeline-total"><strong>{loading || !summary ? "—" : summary.candidates}</strong><span>total candidates</span></div>
          <div className="stage-list">
            {pipeline.map(({ _id, count }) => (
              <div className="stage-row" key={_id}><div className="stage-meta"><span>{_id[0]?.toUpperCase()}{_id.slice(1)}</span><b>{count}</b></div><div className="stage-track"><i className={stageColors[_id] || "bar-dark"} style={{ width: `${(count / maximumStageCount) * 100}%` }} /></div></div>
            ))}
            {!loading && summary && pipeline.length === 0 && <div className="empty-inline">No applications have been added yet.</div>}
          </div>
          <button className="text-link" onClick={() => onView("Candidates")}>View full pipeline <ArrowRight size={14} /></button>
        </div>
      </section>

      <section className="content-grid lower-grid">
        <div className="panel candidates-panel">
          <div className="panel-heading">
            <div><h2>Recently updated candidates</h2><p>Most recently changed records</p></div>
            <button className="text-link" onClick={() => onView("Candidates")}>View all <ArrowRight size={14} /></button>
          </div>
          <div className="table-scroll">
            <table className="candidate-table">
              <thead><tr><th>Candidate</th><th>Position</th><th>Stage</th><th>Match score</th><th /></tr></thead>
              <tbody>{candidates.slice(0, 4).map((candidate) => <CandidateRow key={candidate.id} candidate={candidate} />)}</tbody>
            </table>
            {!loading && summary && candidates.length === 0 && <div className="empty-inline">No candidates yet. Add a candidate to start your talent database.</div>}
          </div>
        </div>
        <div className="panel activity-panel">
          <div className="panel-heading"><div><h2>Recent activity</h2><p>Latest updates from your team</p></div><button className="more-button" aria-label="More options"><MoreHorizontal size={19} /></button></div>
          {activities.map((activity) => {
            const name = activity.actorId?.name || "Team member";
            const initials = name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
            return <ActivityItem key={activity._id} initials={initials} color="sage" text={<><b>{name}</b> {activity.summary}</>} time={formatRelativeTime(activity.createdAt)} />;
          })}
          {!loading && summary && activities.length === 0 && <div className="empty-inline">No activity recorded yet.</div>}
          <button className="text-link activity-link" onClick={() => onView("Activity")}>View all activity <ArrowRight size={14} /></button>
        </div>
      </section>

      <section className="panel resume-panel">
        <div className="panel-heading"><div><h2>Recent resumes</h2><p>Private PDF files saved for your organization</p></div></div>
        {resumes.length > 0 ? <div className="resume-list">{resumes.slice(0, 5).map((resume) => (
          <div className="resume-row" key={resume._id}>
            <FileText size={17} />
            <div className="resume-copy"><strong>{resume.originalName}</strong><span>{typeof resume.candidateId === "object" && resume.candidateId ? resume.candidateId.name || "Candidate linked" : "Not linked to a candidate"} · {formatFileSize(resume.size)}</span></div>
            <button className="icon-button" aria-label={`Download ${resume.originalName}`} onClick={() => void onDownload(resume)}><Download size={16} /></button>
          </div>
        ))}</div> : <div className="empty-inline">{loading ? "Loading resumes..." : "No resumes uploaded yet. Upload a PDF resume to store it securely."}</div>}
      </section>

    </>
  );
}

function StatCard({ label, value, caption, icon }: { label: string; value: string; caption: string; icon: ReactNode }) {
  return <div className="panel stat-card"><div className="stat-top"><span>{label}</span><span className="stat-icon">{icon}</span></div><div className="stat-value">{value}</div><div className="stat-bottom"><span>{caption}</span></div></div>;
}

function CandidateRow({ candidate }: { candidate: Candidate }) {
  const [selected, setSelected] = useState(false);
  return <tr onClick={() => setSelected(!selected)} className={selected ? "row-selected" : ""}><td><div className="candidate-cell"><Avatar candidate={candidate} /><div><strong>{candidate.name}</strong><small>{candidate.email}</small></div></div></td><td><span className="position-text">{candidate.role}</span></td><td><StageBadge stage={candidate.stage} /></td><td><span className="match-score">{candidate.match === null ? "—" : <><Sparkles size={13} />{candidate.match}%</>}</span></td><td><button className="row-more" aria-label={`More about ${candidate.name}`}><MoreHorizontal size={17} /></button></td></tr>;
}

function formatRelativeTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  const diff = Date.now() - date.getTime();
  const unit = diff < 60_000 ? "second" : diff < 3_600_000 ? "minute" : diff < 86_400_000 ? "hour" : "day";
  const amount = unit === "second" ? 1_000 : unit === "minute" ? 60_000 : unit === "hour" ? 3_600_000 : 86_400_000;
  return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(-Math.floor(diff / amount), unit);
}

function StageBadge({ stage }: { stage: string }) {
  const className = stage.toLowerCase();
  return <span className={`stage-badge stage-${className}`}>{stage}</span>;
}

function ActivityItem({ initials, color, text, time }: { initials: string; color: string; text: ReactNode; time: string }) {
  return <div className="activity-item"><div className={`activity-avatar avatar-${color}`}>{initials}</div><div className="activity-copy"><p>{text}</p><span>{time}</span></div></div>;
}

function CandidatesPage({ filtered, query, setQuery, stage, setStage, onSelect, onCreated, token, loading, dataUnavailable }: {
  filtered: Candidate[];
  query: string;
  setQuery: (value: string) => void;
  stage: string;
  setStage: (value: string) => void;
  onSelect: (candidate: Candidate) => void;
  onCreated: (record: CandidateRecord) => void;
  token: string;
  loading: boolean;
  dataUnavailable: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const createCandidate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setSaving(true);
    setError("");
    try {
      const record = await apiRequest<CandidateRecord>("/candidates", token, {
        method: "POST",
        body: JSON.stringify({
          name: formData.get("name"),
          email: formData.get("email"),
          role: formData.get("role"),
          location: formData.get("location"),
          skills: String(formData.get("skills") || "").split(",").map((skill) => skill.trim()).filter(Boolean),
        }),
      });
      onCreated(record);
      setCreating(false);
      form.reset();
    } catch (submitError) {
      setError(getApiErrorMessage(submitError));
    } finally {
      setSaving(false);
    }
  };

  return <>
    <section className="page-title-row"><div><div className="eyebrow">TALENT DATABASE</div><h1>Candidates</h1><p>Manage your organization’s saved candidate records.</p></div><button className="button button-primary" onClick={() => setCreating((current) => !current)}><Plus size={16} /> Add candidate</button></section>
    {creating && <form className="panel record-form" onSubmit={createCandidate}>
      <div className="record-form-heading"><h2>New candidate</h2><button className="icon-button" type="button" aria-label="Close form" onClick={() => setCreating(false)}><X size={16} /></button></div>
      <div className="record-form-grid">
        <label><span>Full name</span><input name="name" required maxLength={140} /></label>
        <label><span>Email</span><input name="email" type="email" required maxLength={254} /></label>
        <label><span>Role</span><input name="role" maxLength={140} /></label>
        <label><span>Location</span><input name="location" maxLength={140} /></label>
        <label className="record-form-wide"><span>Skills (comma separated)</span><input name="skills" placeholder="Research, Figma, Accessibility" /></label>
      </div>
      {error && <div className="auth-error" role="alert">{error}</div>}
      <div className="record-form-actions"><button type="button" className="button button-secondary" onClick={() => setCreating(false)}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? "Saving..." : "Save candidate"}</button></div>
    </form>}
    <div className="panel full-table-panel"><div className="list-toolbar"><div className="list-title"><strong>All candidates</strong><span className="count-pill">{dataUnavailable ? "—" : filtered.length}</span></div><div className="list-actions"><div className="table-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search candidates" /></div><label className="filter-select"><ListFilter size={15} /><select value={stage} onChange={(event) => setStage(event.target.value)}><option>All stages</option><option>New</option><option>Applied</option><option>Screening</option><option>Interview</option><option>Offer</option><option>Hired</option><option>Rejected</option></select><ChevronDown size={13} /></label></div></div>
      <div className="table-scroll"><table className="candidate-table full-table"><thead><tr><th>Candidate</th><th>Position</th><th>Location</th><th>Stage</th><th>Match score</th><th>Last active</th></tr></thead><tbody>{filtered.map((candidate) => <tr key={candidate.id} onClick={() => onSelect(candidate)}><td><div className="candidate-cell"><Avatar candidate={candidate} /><div><strong>{candidate.name}</strong><small>{candidate.email}</small></div></div></td><td><span className="position-text">{candidate.role}</span></td><td>{candidate.location}</td><td><StageBadge stage={candidate.stage} /></td><td><span className="match-score">{candidate.match === null ? "—" : <><Sparkles size={13} />{candidate.match}%</>}</span></td><td>{candidate.lastActive}</td></tr>)}</tbody></table>
      {!loading && !dataUnavailable && filtered.length === 0 && <div className="empty-state"><Search size={22} /><strong>No candidates found</strong><span>{query || stage !== "All stages" ? "Try a different search or stage filter." : "Create a candidate record to start building your talent database."}</span></div>}</div><div className="table-pagination"><span>{loading ? "Loading live records..." : dataUnavailable ? "Data unavailable" : `Showing ${filtered.length} loaded records`}</span></div>
    </div>
  </>;
}

function JobsPage({ jobs, token, onCreated, onNotify, loading, dataUnavailable }: {
  jobs: JobRecord[];
  token: string;
  onCreated: (record: JobRecord) => void;
  onNotify: (text: string) => void;
  loading: boolean;
  dataUnavailable: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const createJob = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setSaving(true);
    setError("");
    try {
      const record = await apiRequest<JobRecord>("/jobs", token, {
        method: "POST",
        body: JSON.stringify({
          title: formData.get("title"),
          department: formData.get("department"),
          location: formData.get("location"),
          employmentType: formData.get("employmentType"),
          description: formData.get("description"),
          status: "active",
          requiredSkills: String(formData.get("requiredSkills") || "").split(",").map((skill) => skill.trim()).filter(Boolean),
        }),
      });
      onCreated(record);
      setCreating(false);
      form.reset();
    } catch (submitError) {
      setError(getApiErrorMessage(submitError));
    } finally {
      setSaving(false);
    }
  };

  return <>
    <section className="page-title-row"><div><div className="eyebrow">HIRING PIPELINE</div><h1>Open positions</h1><p>Live job listings and applications from your organization.</p></div><button className="button button-primary" onClick={() => setCreating((current) => !current)}><Plus size={16} /> Create a job</button></section>
    {creating && <form className="panel record-form" onSubmit={createJob}>
      <div className="record-form-heading"><h2>New job listing</h2><button className="icon-button" type="button" aria-label="Close form" onClick={() => setCreating(false)}><X size={16} /></button></div>
      <div className="record-form-grid">
        <label><span>Job title</span><input name="title" required maxLength={160} /></label>
        <label><span>Department</span><input name="department" maxLength={100} /></label>
        <label><span>Location</span><input name="location" maxLength={140} /></label>
        <label><span>Employment type</span><select name="employmentType" defaultValue="full-time"><option value="full-time">Full-time</option><option value="part-time">Part-time</option><option value="contract">Contract</option><option value="internship">Internship</option></select></label>
        <label className="record-form-wide"><span>Description</span><textarea name="description" rows={4} required maxLength={20000} /></label>
        <label className="record-form-wide"><span>Required skills (comma separated)</span><input name="requiredSkills" /></label>
      </div>
      {error && <div className="auth-error" role="alert">{error}</div>}
      <div className="record-form-actions"><button type="button" className="button button-secondary" onClick={() => setCreating(false)}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? "Saving..." : "Publish job"}</button></div>
    </form>}
    <div className="jobs-grid">{jobs.map((job) => {
      const color = job.status === "active" ? "green" : job.status === "closed" ? "orange" : "blue";
      const status = job.status[0].toUpperCase() + job.status.slice(1).replace("-", " ");
      const type = job.employmentType.replace("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
      return <div className="panel job-card" key={job._id}><div className="job-card-top"><div className={`job-icon job-${color}`}><BriefcaseBusiness size={18} /></div><span className="job-team">{job.department || "Department not set"}</span></div><h2>{job.title}</h2><div className="job-details"><span><Users size={14} />{job.applicantCount ?? 0} applicants</span><span><span className="location-dot" />{job.location || "Location not set"}</span></div><div className="job-card-bottom"><span className={`job-status ${job.status === "active" ? "status-active" : "status-hold"}`}><i />{status}</span><span>{type}</span></div><div className="job-card-actions"><button className="button button-secondary button-sm" onClick={() => onNotify(`Job ID: ${job._id}`)}>Job details <ArrowRight size={14} /></button></div></div>;
    })}{!loading && !dataUnavailable && jobs.length === 0 && <div className="empty-state"><BriefcaseBusiness size={22} /><strong>No job listings yet</strong><span>Create your first job to start receiving applications.</span></div>}</div>
  </>;
}

function ActivityPage({ activities, loading, dataUnavailable, onRefresh }: {
  activities: ActivityRecord[];
  loading: boolean;
  dataUnavailable: boolean;
  onRefresh: () => void;
}) {
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const filtered = activities.filter((activity) => filter === "all" || activity.entityType === filter);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);

  return <>
    <section className="page-title-row">
      <div><div className="eyebrow">WORKSPACE HISTORY</div><h1>Activity timeline</h1><p>Recent changes made across your organization.</p></div>
      <button className="button button-secondary" onClick={onRefresh}><Activity size={15} /> Refresh activity</button>
    </section>
    <div className="panel timeline-panel">
      <div className="timeline-toolbar">
        <div><strong>Recent events</strong><span>{dataUnavailable ? "Unavailable" : `${filtered.length} events · latest 100`}</span></div>
        <label className="filter-select"><ListFilter size={15} /><select value={filter} onChange={(event) => { setFilter(event.target.value); setPage(1); }}>
          <option value="all">All activity</option><option value="candidate">Candidates</option><option value="job">Jobs</option><option value="application">Applications</option><option value="interview">Interviews</option><option value="resume">Resumes</option>
        </select><ChevronDown size={13} /></label>
      </div>
      {visible.length > 0 ? <div className="timeline-list">{visible.map((activity) => {
        const name = activity.actorId?.name || "Team member";
        const initials = name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
        return <div className="timeline-row" key={activity._id}>
          <ActivityItem initials={initials} color="sage" text={<><b>{name}</b> {activity.summary}</>} time={formatRelativeTime(activity.createdAt)} />
          <span className="timeline-category">{activity.entityType || activity.eventType.split(".")[0]}</span>
        </div>;
      })}</div> : <div className="empty-state"><Activity size={22} /><strong>{loading ? "Loading activity..." : dataUnavailable ? "Activity is unavailable" : "No activity found"}</strong><span>{dataUnavailable ? "Check the live data connection and try again." : "Changes to candidates, jobs, applications, interviews, and resumes will appear here."}</span></div>}
      {filtered.length > 0 && <div className="timeline-pagination">
        <span>Page {page} of {pageCount}</span>
        <div><button className="button button-secondary button-sm" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</button><button className="button button-secondary button-sm" disabled={page >= pageCount} onClick={() => setPage((current) => current + 1)}>Next</button></div>
      </div>}
    </div>
  </>;
}

function ReportsPage({ summary, jobs, loading, dataUnavailable, onNotify }: {
  summary: DashboardSummary | null;
  jobs: JobRecord[];
  loading: boolean;
  dataUnavailable: boolean;
  onNotify: (text: string) => void;
}) {
  const pipeline = summary?.pipeline || [];
  const stages = ["applied", "screening", "interview", "offer", "hired", "rejected"].map((stage) => ({
    stage,
    count: pipeline.find((item) => item._id === stage)?.count || 0,
  }));
  const totalApplications = stages.reduce((total, item) => total + item.count, 0);
  const activityCount = (summary?.activityByDay || []).reduce((total, item) => total + item.count, 0);
  const downloadReport = () => {
    if (!summary) {
      onNotify("Report data is not available yet.");
      return;
    }
    const rows: string[][] = [
      ["HireCompanion hiring report", new Date().toLocaleString()],
      [],
      ["Metric", "Value"],
      ["Candidates", String(summary.candidates)],
      ["Active jobs", String(summary.openJobs)],
      ["Applications", String(totalApplications)],
      ["Interviews in next 7 days", String(summary.upcomingInterviews)],
      ["Activity events in last 14 days", String(activityCount)],
      [],
      ["Pipeline stage", "Applications"],
      ...stages.map(({ stage, count }) => [stage, String(count)]),
      [],
      ["Job", "Department", "Location", "Status", "Applicants"],
      ...jobs.map((job) => [job.title, job.department || "", job.location || "", job.status, String(job.applicantCount || 0)]),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `hirecompanion-report-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    onNotify("Hiring report downloaded.");
  };

  return <>
    <section className="page-title-row">
      <div><div className="eyebrow">HIRING INSIGHTS</div><h1>Reports</h1><p>Live organization snapshot with pipeline and job-level breakdowns.</p></div>
      <button className="button button-primary" onClick={downloadReport} disabled={loading || dataUnavailable}><Download size={15} /> Export CSV</button>
    </section>
    <section className="stats-grid report-stats">
      <StatCard label="Candidates" value={loading || !summary ? "—" : String(summary.candidates)} caption="Saved in your organization" icon={<Users size={17} />} />
      <StatCard label="Active jobs" value={loading || !summary ? "—" : String(summary.openJobs)} caption="Currently accepting applicants" icon={<BriefcaseBusiness size={17} />} />
      <StatCard label="Applications" value={loading || !summary ? "—" : String(totalApplications)} caption="Active pipeline" icon={<Clock3 size={17} />} />
      <StatCard label="Interviews" value={loading || !summary ? "—" : String(summary.upcomingInterviews)} caption="Scheduled in the next 7 days" icon={<CalendarDays size={17} />} />
    </section>
    <div className="reports-grid">
      <section className="panel report-panel">
        <div className="panel-heading"><div><h2>Application pipeline</h2><p>Active applications by current stage</p></div></div>
        {stages.map(({ stage, count }) => <div className="report-stage-row" key={stage}><span>{stage.replace(/\b\w/g, (letter) => letter.toUpperCase())}</span><div className="report-stage-track"><i style={{ width: `${totalApplications ? (count / totalApplications) * 100 : 0}%` }} /></div><strong>{loading || dataUnavailable ? "—" : count}</strong></div>)}
      </section>
      <section className="panel report-panel report-activity-card">
        <div className="panel-heading"><div><h2>Team activity</h2><p>Recorded events in the last 14 days</p></div><Activity size={17} /></div>
        <div className="report-big-number">{loading || !summary ? "—" : activityCount}</div>
        <span className="report-muted">activity events</span>
      </section>
    </div>
    <section className="panel report-panel report-jobs-panel">
      <div className="panel-heading"><div><h2>Job performance</h2><p>Applicant counts for the latest loaded job listings</p></div><span className="count-pill">{dataUnavailable ? "—" : jobs.length}</span></div>
      <div className="table-scroll"><table className="candidate-table full-table"><thead><tr><th>Job</th><th>Department</th><th>Location</th><th>Status</th><th>Applicants</th></tr></thead><tbody>
        {jobs.map((job) => <tr key={job._id}><td><strong>{job.title}</strong></td><td>{job.department || "—"}</td><td>{job.location || "—"}</td><td><StageBadge stage={job.status.replace("-", " ")} /></td><td>{job.applicantCount || 0}</td></tr>)}
      </tbody></table>
      {!loading && !dataUnavailable && jobs.length === 0 && <div className="empty-inline">No job listings are available for this report.</div>}</div>
    </section>
  </>;
}

function InterviewsPage({ interviews, token, loading, onCreated, onNotify, dataUnavailable }: {
  interviews: InterviewRecord[];
  token: string;
  loading: boolean;
  onCreated: () => void;
  onNotify: (text: string) => void;
  dataUnavailable: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [applications, setApplications] = useState<ApplicationRecord[]>([]);
  const [formLoading, setFormLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const openForm = async () => {
    setCreating(true);
    setFormLoading(true);
    setError("");
    try {
      setApplications(await apiRequest<ApplicationRecord[]>("/applications?limit=100", token));
    } catch (loadError) {
      setError(getApiErrorMessage(loadError));
    } finally {
      setFormLoading(false);
    }
  };

  const scheduleInterview = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setSaving(true);
    setError("");
    try {
      await apiRequest<InterviewRecord>("/interviews", token, {
        method: "POST",
        body: JSON.stringify({
          applicationId: formData.get("applicationId"),
          scheduledAt: formData.get("scheduledAt"),
          type: formData.get("type"),
        }),
      });
      setCreating(false);
      onCreated();
    } catch (submitError) {
      setError(getApiErrorMessage(submitError));
    } finally {
      setSaving(false);
    }
  };

  const nextWeek = new Date(Date.now() + 7 * 86400000);
  const upcoming = interviews.filter((interview) => interview.status === "scheduled" && new Date(interview.scheduledAt) <= nextWeek);
  return <>
    <section className="page-title-row"><div><div className="eyebrow">YOUR TEAM’S CALENDAR</div><h1>Interviews</h1><p>Upcoming interviews scheduled for your candidates.</p></div><button className="button button-primary" onClick={() => void openForm()}><Plus size={16} /> Schedule interview</button></section>
    {creating && <form className="panel record-form" onSubmit={scheduleInterview}>
      <div className="record-form-heading"><h2>Schedule an interview</h2><button className="icon-button" type="button" aria-label="Close form" onClick={() => setCreating(false)}><X size={16} /></button></div>
      {formLoading ? <p>Loading applications…</p> : applications.length === 0 ? <p>Create an application before scheduling an interview.</p> : <div className="record-form-grid">
        <label className="record-form-wide"><span>Candidate and job</span><select name="applicationId" required>{applications.map((application) => <option key={application._id} value={application._id}>{application.candidateId?.name || "Candidate"} — {application.jobId?.title || "Job"}</option>)}</select></label>
        <label><span>Date and time</span><input type="datetime-local" name="scheduledAt" required min={new Date().toISOString().slice(0, 16)} /></label>
        <label><span>Interview type</span><select name="type"><option value="screening">Screening</option><option value="technical">Technical</option><option value="portfolio">Portfolio</option><option value="culture">Culture</option><option value="other">Other</option></select></label>
      </div>}
      {error && <div className="auth-error" role="alert">{error}</div>}
      <div className="record-form-actions"><button type="button" className="button button-secondary" onClick={() => setCreating(false)}>Cancel</button><button className="button button-primary" disabled={saving || formLoading || applications.length === 0}>{saving ? "Scheduling..." : "Schedule"}</button></div>
    </form>}
    <div className="interview-layout"><div className="panel interview-list"><div className="panel-heading"><div><h2>Upcoming interviews</h2><p>{new Date().toLocaleDateString()} – {nextWeek.toLocaleDateString()}</p></div><span className="select-button">Next 7 days</span></div>
      {upcoming.map((interview) => {
        const candidateName = interview.applicationId?.candidateId?.name || "Candidate";
        const initials = candidateName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
        const date = new Date(interview.scheduledAt);
        return <div className="interview-row" key={interview._id}><div className="interview-time">{date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}<span>{date.toLocaleDateString()}</span></div><Avatar candidate={{ initials, color: "sage" }} /><div className="interview-candidate"><strong>{candidateName}</strong><span>{interview.applicationId?.candidateId?.role || interview.applicationId?.jobId?.title || "Role not specified"}</span></div><div className="interview-type"><span>{interview.type}</span><small>{interview.status}</small></div><button className="icon-button" aria-label="Interview details" onClick={() => onNotify(`Interview ID: ${interview._id}`)}><MoreHorizontal size={18} /></button></div>;
      })}
      {!loading && !dataUnavailable && upcoming.length === 0 && <div className="empty-state"><CalendarDays size={22} /><strong>No upcoming interviews</strong><span>Schedule one from an existing application.</span></div>}
    </div><div className="panel interview-summary"><div className="panel-heading"><div><h2>Next 7 days</h2><p>Live interview schedule</p></div></div><div className="interview-summary-number">{loading || dataUnavailable ? "—" : upcoming.length} <span>scheduled</span></div><div className="summary-bar"><i style={{ width: `${Math.min(upcoming.length * 10, 100)}%` }} /></div><div className="summary-foot"><span>From saved applications</span><strong>{loading ? "Loading" : dataUnavailable ? "Unavailable" : "Up to date"}</strong></div><div className="summary-divider" /><div className="summary-stat"><span>Upcoming count</span><strong>{loading || dataUnavailable ? "—" : upcoming.length}</strong></div><button className="button button-secondary summary-button" onClick={() => onNotify("Interview data refreshes automatically")}>Refreshes every 15 seconds <ArrowRight size={14} /></button></div></div>
  </>;
}

function CandidateDrawer({ candidate, jobs, resumes, token, onClose, onNotify, onUpload, onDownload, onApplicationCreated }: {
  candidate: Candidate;
  jobs: JobRecord[];
  resumes: ResumeRecord[];
  token: string;
  onClose: () => void;
  onNotify: (text: string) => void;
  onUpload: (file: File, candidateId?: string) => Promise<void>;
  onDownload: (resume: ResumeRecord) => Promise<void>;
  onApplicationCreated: () => void;
}) {
  const [creatingApplication, setCreatingApplication] = useState(false);
  const [savingApplication, setSavingApplication] = useState(false);
  const [uploadingResume, setUploadingResume] = useState(false);
  const [applicationError, setApplicationError] = useState("");
  const resumeInput = useRef<HTMLInputElement>(null);
  const activeJobs = jobs.filter((job) => job.status === "active");
  const candidateResumes = resumes.filter((resume) =>
    typeof resume.candidateId === "object" && resume.candidateId?._id === candidate.id,
  );

  const createApplication = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setSavingApplication(true);
    setApplicationError("");
    try {
      await apiRequest("/applications", token, {
        method: "POST",
        body: JSON.stringify({ candidateId: candidate.id, jobId: formData.get("jobId") }),
      });
      onApplicationCreated();
    } catch (error) {
      setApplicationError(getApiErrorMessage(error));
    } finally {
      setSavingApplication(false);
    }
  };

  return <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className="candidate-drawer">
      <div className="drawer-top"><span>Candidate profile</span><button className="icon-button" onClick={onClose} aria-label="Close profile"><X size={18} /></button></div>
      <div className="drawer-profile"><Avatar candidate={candidate} size="lg" /><h2>{candidate.name}</h2><p>{candidate.role}</p><span>{candidate.location} · {candidate.experience} experience</span>
        <div><button className="button button-primary button-sm" onClick={() => { setCreatingApplication((current) => !current); setApplicationError(""); }}><Plus size={14} /> Add to a job</button><button className="button button-secondary button-sm" onClick={() => onNotify("Email integration is not configured.")}><MessageSquareText size={14} /> Message</button></div>
      </div>
      {creatingApplication && <form className="drawer-section" onSubmit={createApplication}><div className="drawer-section-title"><h3>Create application</h3></div>{activeJobs.length ? <><label className="drawer-field"><span>Active job</span><select name="jobId" required>{activeJobs.map((job) => <option key={job._id} value={job._id}>{job.title}</option>)}</select></label>{applicationError && <div className="auth-error" role="alert">{applicationError}</div>}<button className="button button-primary button-sm" disabled={savingApplication}>{savingApplication ? "Saving..." : "Save application"}</button></> : <p className="match-explanation">Create an active job before adding applications.</p>}</form>}
      {candidate.match !== null && <div className="drawer-section"><div className="drawer-section-title"><h3>Application match score</h3><span><Sparkles size={13} />{candidate.match}%</span></div><div className="match-progress"><i style={{ width: `${candidate.match}%` }} /></div></div>}
      <div className="drawer-section"><div className="drawer-section-title"><h3>Skills</h3></div>{candidate.skills.length ? <div className="skill-list">{candidate.skills.map((skill) => <span key={skill}>{skill}</span>)}</div> : <p className="match-explanation">No skills saved for this candidate.</p>}</div>
      <div className="drawer-section">
        <div className="drawer-section-title"><h3>Resume</h3><button className="text-link" onClick={() => resumeInput.current?.click()} disabled={uploadingResume}><Upload size={13} /> {uploadingResume ? "Uploading..." : "Upload PDF"}</button></div>
        <input ref={resumeInput} type="file" accept=".pdf,application/pdf" hidden onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) {
            setUploadingResume(true);
            void onUpload(file, candidate.id).finally(() => setUploadingResume(false));
          }
        }} />
        {candidateResumes.length ? candidateResumes.map((resume) => <div className="resume-row drawer-resume-row" key={resume._id}><FileText size={15} /><div className="resume-copy"><strong>{resume.originalName}</strong><span>{formatFileSize(resume.size)}</span></div><button className="icon-button" aria-label={`Download ${resume.originalName}`} onClick={() => void onDownload(resume)}><Download size={15} /></button></div>) : <p className="match-explanation">No resume has been uploaded for this candidate.</p>}
      </div>
    </aside>
  </div>;
}

export default App;
