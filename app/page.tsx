"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive, Check, ChevronDown, Cloud, FileImage,
  FileText, Film, Folder, HardDrive, Home, Link2, LockKeyhole, MoreHorizontal,
  Plus, Search, Settings2, ShieldCheck, Upload, X
} from "lucide-react";

type GitHubStatus = {
  connected: boolean;
  user: { login: string; avatarUrl: string; name: string | null } | null;
  storageRepo: { id: number; fullName: string; name: string; owner: string; defaultBranch: string } | null;
};

type RepoOption = {
  id: number;
  name: string;
  fullName: string;
  description: string | null;
  defaultBranch: string;
};

type DriveFile = {
  id: string;
  name: string;
  type: "video" | "image" | "document" | "archive";
  size: string;
  modified: string;
  source: "sample" | "local";
};

const initialFiles: DriveFile[] = [
  { id: "1", name: "Product-demo-final.mp4", type: "video", size: "248 MB", modified: "Today, 10:42 AM", source: "sample" },
  { id: "2", name: "Brand-assets.zip", type: "archive", size: "84 MB", modified: "Yesterday", source: "sample" },
  { id: "3", name: "Invoice-November.pdf", type: "document", size: "1.8 MB", modified: "Nov 15, 2026", source: "sample" },
  { id: "4", name: "Launch-cover.png", type: "image", size: "6.2 MB", modified: "Nov 13, 2026", source: "sample" }
];

function formatSize(bytes: number) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

function fileType(name: string): DriveFile["type"] {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["mp4", "mov", "mkv", "webm"].includes(ext)) return "video";
  if (["png", "jpg", "jpeg", "webp", "gif", "svg"].includes(ext)) return "image";
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "archive";
  return "document";
}

function FileGlyph({ type }: { type: DriveFile["type"] }) {
  const common = "h-5 w-5";
  if (type === "video") return <Film className={common + " text-violet-600"} />;
  if (type === "image") return <FileImage className={common + " text-emerald-600"} />;
  if (type === "archive") return <Archive className={common + " text-amber-600"} />;
  return <FileText className={common + " text-blue-600"} />;
}

export default function HomePage() {
  const [files, setFiles] = useState(initialFiles);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("GitHub connection is not configured yet. Your files stay on this device in this preview.");
  const [selected, setSelected] = useState<string | null>(null);
  const [githubStatus, setGithubStatus] = useState<GitHubStatus>({
    connected: false,
    user: null,
    storageRepo: null
  });
  const [repositories, setRepositories] = useState<RepoOption[]>([]);
  const [selectedRepo, setSelectedRepo] = useState("");
  const [savingRepo, setSavingRepo] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const visibleFiles = useMemo(
    () => files.filter((file) => file.name.toLowerCase().includes(query.toLowerCase())),
    [files, query]
  );

  useEffect(() => {
    let cancelled = false;

    async function loadConnection() {
      try {
        const statusResponse = await fetch("/api/auth/session", { cache: "no-store" });
        const status = (await statusResponse.json()) as GitHubStatus;
        if (cancelled) return;
        setGithubStatus(status);

        if (status.connected) {
          const repoResponse = await fetch("/api/github/repositories", { cache: "no-store" });
          const repoData = (await repoResponse.json()) as { repositories?: RepoOption[]; error?: string };
          if (cancelled) return;
          if (repoResponse.ok && repoData.repositories) {
            setRepositories(repoData.repositories);
            setSelectedRepo(status.storageRepo?.fullName ?? repoData.repositories[0]?.fullName ?? "");
          } else if (repoData.error) {
            setNotice(repoData.error);
          }
        }
      } catch {
        if (!cancelled) setNotice("Could not check GitHub connection. Refresh the page to try again.");
      }
    }

    loadConnection();

    const authResult = new URLSearchParams(window.location.search).get("auth");
    const authMessages: Record<string, string> = {
      connected: "GitHub connected. Now choose a private repository for your files.",
      not_configured: "GitHub App setup is still needed. Add the four environment variables listed in .env.example to Vercel.",
      denied: "GitHub authorization was cancelled.",
      invalid_state: "The security check expired. Please connect GitHub again.",
      token_failed: "GitHub did not issue an access token. Check the GitHub App settings and try again.",
      profile_failed: "GitHub authorized the app, but the profile could not be loaded.",
      callback_failed: "GitHub connection could not be completed. Check the Vercel function logs.",
      failed: "GitHub connection failed. Please try again."
    };
    if (authResult) {
      setNotice(authMessages[authResult] ?? "GitHub connection returned an unexpected result.");
      window.history.replaceState({}, "", window.location.pathname);
    }

    return () => { cancelled = true; };
  }, []);

  function addFiles(fileList: FileList | null) {
    if (!fileList?.length) return;
    const added = Array.from(fileList).map((file) => ({
      id: crypto.randomUUID(),
      name: file.name,
      type: fileType(file.name),
      size: formatSize(file.size),
      modified: "Just now",
      source: "local" as const
    }));
    setFiles((current) => [...added, ...current]);
    setNotice(added.length + " file(s) added to this local preview. These files have not been uploaded to GitHub.");
  }

  async function saveStorageRepo() {
    if (!selectedRepo) return;
    setSavingRepo(true);
    try {
      const response = await fetch("/api/github/storage-repo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName: selectedRepo })
      });
      const data = await response.json() as { storageRepo?: GitHubStatus["storageRepo"]; error?: string };
      if (!response.ok || !data.storageRepo) {
        setNotice(data.error ?? "Could not select this storage repository.");
        return;
      }
      setGithubStatus((current) => ({ ...current, storageRepo: data.storageRepo ?? null }));
      setNotice("Private storage repository linked: " + data.storageRepo.fullName + ". File upload is the next build step.");
    } catch {
      setNotice("Could not save the storage repository. Please try again.");
    } finally {
      setSavingRepo(false);
    }
  }

  async function disconnectGitHub() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      setGithubStatus({ connected: false, user: null, storageRepo: null });
      setRepositories([]);
      setSelectedRepo("");
      setNotice("GitHub has been disconnected from this browser session.");
    } catch {
      setNotice("Could not disconnect GitHub. Please try again.");
    }
  }

  return (
    <main className="min-h-screen">
      <div className="mx-auto flex min-h-screen max-w-[1500px]">
        <aside className="hidden w-[248px] shrink-0 border-r border-line bg-white px-5 py-7 lg:flex lg:flex-col">
          <a href="#" className="mb-10 flex items-center gap-3 px-2 no-underline">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-brand text-white"><Cloud className="h-5 w-5" /></span>
            <span><span className="block text-lg font-bold tracking-tight text-ink">GitDrive</span><span className="text-xs text-muted">Your personal cloud</span></span>
          </a>
          <p className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Workspace</p>
          <nav className="space-y-1">
            <a className="flex items-center gap-3 rounded-xl bg-indigo-50 px-3 py-2.5 text-sm font-semibold text-brand"><Home className="h-4 w-4" /> My Drive</a>
            <a className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-600"><Folder className="h-4 w-4" /> Shared with me</a>
            <a className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-600"><Archive className="h-4 w-4" /> Backups</a>
          </nav>
          <div className="mt-auto rounded-2xl border border-line bg-slate-50 p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="h-4 w-4 text-emerald-600" /> Privacy first</div>
            <p className="text-xs leading-5 text-muted">Client-side encryption is planned before any file leaves your device.</p>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-200"><div className="h-full w-[8%] rounded-full bg-brand" /></div>
            <p className="mt-2 text-[11px] text-muted">Setup progress · 1 of 5</p>
          </div>
        </aside>

        <section className="min-w-0 flex-1">
          <header className="sticky top-0 z-10 flex h-[72px] items-center justify-between border-b border-line bg-white/90 px-4 backdrop-blur md:px-8">
            <div className="flex items-center gap-3 lg:hidden">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand text-white"><Cloud className="h-5 w-5" /></span>
              <span className="font-bold tracking-tight">GitDrive</span>
            </div>
            <div className="relative hidden w-full max-w-md md:block">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your files..." className="h-10 w-full rounded-xl border border-line bg-slate-50 pl-10 pr-4 text-sm outline-none transition focus:border-indigo-300 focus:bg-white" />
            </div>
            <div className="ml-auto flex items-center gap-2">
              {githubStatus.connected ? (
                <>
                  <span className="hidden max-w-[150px] truncate rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 sm:inline-flex">Connected · {githubStatus.user?.login}</span>
                  <button onClick={disconnectGitHub} className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-white px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-50">Disconnect</button>
                </>
              ) : (
                <a href="/api/auth/github" className="inline-flex h-10 items-center gap-2 rounded-xl bg-ink px-4 text-sm font-semibold text-white transition hover:bg-slate-700"><Link2 className="h-4 w-4" /> Connect GitHub</a>
              )}
              <button aria-label="Settings" className="hidden h-10 w-10 place-items-center rounded-xl border border-line text-slate-500 sm:grid"><Settings2 className="h-4 w-4" /></button>
            </div>
          </header>

          <div className="mx-auto max-w-6xl px-4 py-7 md:px-8 md:py-10">
            <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
              <div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-brand">Your workspace</p><h1 className="text-3xl font-bold tracking-tight text-ink md:text-[34px]">My Drive</h1><p className="mt-2 text-sm text-muted">A simple home for all your files.</p></div>
              <button onClick={() => inputRef.current?.click()} className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"><Plus className="h-4 w-4" /> Add files</button>
              <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
            </div>

            <div className="mb-6 grid gap-4 md:grid-cols-[1.4fr_1fr]">
              <div className="rounded-2xl bg-gradient-to-br from-[#292a72] via-[#4546b9] to-[#7778f2] p-6 text-white shadow-soft md:p-7">
                <div className="flex items-start justify-between gap-4"><div><p className="text-sm font-medium text-indigo-100">Storage overview</p><p className="mt-3 text-3xl font-bold tracking-tight">Ready for your files</p><p className="mt-2 max-w-sm text-sm leading-6 text-indigo-100">Connect GitHub to set up your private storage space. No storage quota is being claimed in this preview.</p></div><span className="rounded-2xl bg-white/15 p-3"><HardDrive className="h-6 w-6" /></span></div>
                <div className="mt-7 flex items-center justify-between border-t border-white/20 pt-4 text-xs text-indigo-100"><span>GitHub storage</span><span>{githubStatus.storageRepo?.fullName ?? (githubStatus.connected ? "Choose a private repo" : "Not connected")}</span></div>
              </div>
              <div className="rounded-2xl border border-line bg-white p-6 shadow-soft">
                <div className="flex items-center justify-between"><span className="text-sm font-semibold text-ink">Security status</span><LockKeyhole className="h-5 w-5 text-emerald-600" /></div>
                <p className="mt-5 text-2xl font-bold tracking-tight">Setup pending</p>
                <p className="mt-2 text-sm leading-6 text-muted">Encryption and recovery-key setup will be required before remote uploads are enabled.</p>
                <div className="mt-5 flex items-center gap-2 text-xs font-medium text-emerald-700"><ShieldCheck className="h-4 w-4" /> Security-first setup</div>
              </div>
            </div>

            {githubStatus.connected && (
              <section className="mb-6 rounded-2xl border border-line bg-white p-5 shadow-soft md:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-ink">Private storage repository</p>
                    <p className="mt-1 text-xs leading-5 text-muted">Choose a private repository that your GitHub App can write to. The public GitDrive source repository is not used for personal files.</p>
                  </div>
                  <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">GitHub connected</span>
                </div>
                {repositories.length > 0 ? (
                  <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                    <select value={selectedRepo} onChange={(e) => setSelectedRepo(e.target.value)} className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-white px-3 text-sm text-ink outline-none focus:border-indigo-300">
                      {repositories.map((repo) => <option key={repo.id} value={repo.fullName}>{repo.fullName}</option>)}
                    </select>
                    <button onClick={saveStorageRepo} disabled={!selectedRepo || savingRepo} className="h-11 rounded-xl bg-brand px-4 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">{savingRepo ? "Saving..." : githubStatus.storageRepo ? "Change repository" : "Use this repository"}</button>
                  </div>
                ) : (
                  <p className="mt-4 rounded-xl bg-amber-50 px-3 py-3 text-xs leading-5 text-amber-800">No private writable repositories were returned. Create a private repository such as GitDrive-Storage, then install your GitHub App on that repository with Contents read and write permission.</p>
                )}
                {githubStatus.storageRepo && <p className="mt-3 flex items-center gap-2 text-xs font-medium text-emerald-700"><ShieldCheck className="h-4 w-4" /> Selected: {githubStatus.storageRepo.fullName}</p>}
              </section>
            )}

            <div className="mb-5 rounded-2xl border border-indigo-100 bg-indigo-50/70 px-4 py-3 text-sm text-indigo-900">
              <div className="flex items-start gap-2"><Cloud className="mt-0.5 h-4 w-4 shrink-0" /><p>{notice}</p><button onClick={() => setNotice("")} aria-label="Dismiss notice" className="ml-auto text-indigo-500"><X className="h-4 w-4" /></button></div>
            </div>

            <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }} className="mb-8 flex flex-col items-center justify-center rounded-2xl border border-dashed border-indigo-200 bg-white px-5 py-8 text-center transition hover:border-brand hover:bg-indigo-50/30">
              <span className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-indigo-50 text-brand"><Upload className="h-5 w-5" /></span>
              <p className="text-sm font-semibold text-ink">Drop files here to preview</p>
              <p className="mt-1 text-xs text-muted">or <button onClick={() => inputRef.current?.click()} className="font-semibold text-brand underline underline-offset-2">browse from your device</button></p>
              <p className="mt-3 text-[11px] text-slate-400">Local preview only · Remote upload is not enabled yet</p>
            </div>

            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div><h2 className="text-lg font-bold tracking-tight text-ink">Recent files</h2><p className="mt-1 text-xs text-muted">{visibleFiles.length} items shown · sample rows are illustrative</p></div>
              <button className="inline-flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-xs font-medium text-slate-600">Last modified <ChevronDown className="h-3.5 w-3.5" /></button>
            </div>

            <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-soft">
              <div className="hidden grid-cols-[minmax(0,1fr)_110px_170px_40px] gap-4 border-b border-line bg-slate-50/70 px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400 md:grid"><span>Name</span><span>File size</span><span>Last modified</span><span /></div>
              {visibleFiles.length === 0 ? <div className="px-5 py-12 text-center text-sm text-muted">No matching files.</div> : visibleFiles.map((file) => (
                <div key={file.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-line px-4 py-4 last:border-0 md:grid-cols-[minmax(0,1fr)_110px_170px_40px] md:gap-4 md:px-5">
                  <div className="flex min-w-0 items-center gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-50"><FileGlyph type={file.type} /></span><div className="min-w-0"><p className="truncate text-sm font-semibold text-ink">{file.name}</p><p className="mt-1 text-[11px] text-muted">{file.source === "local" ? "Local preview" : "Sample file"}</p></div></div>
                  <span className="text-xs text-slate-600">{file.size}</span><span className="hidden text-xs text-slate-500 md:block">{file.modified}</span>
                  <button onClick={() => setSelected(selected === file.id ? null : file.id)} aria-label={"More actions for " + file.name} className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><MoreHorizontal className="h-4 w-4" /></button>
                  {selected === file.id && <div className="col-span-2 -mt-1 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 md:col-span-4">Remote actions will appear after GitHub storage is connected.</div>}
                </div>
              ))}
            </div>
            <footer className="mt-8 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400"><span>GitDrive · Built for a calmer file workflow</span><span className="flex items-center gap-1"><Check className="h-3 w-3" /> Your local preview is working</span></footer>
          </div>
        </section>
      </div>
    </main>
  );
}
