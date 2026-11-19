"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive, ArrowDownToLine, Check, ChevronRight, Cloud, CloudUpload,
  FileImage, FileText, Film, FolderOpen, HardDrive, Home, Image as ImageIcon,
  LayoutGrid, Link2, List, LockKeyhole, LogIn, Plus, Search, Settings,
  ShieldCheck, SlidersHorizontal, X
} from "lucide-react";

type GitHubStatus = {
  appConfigured: boolean;
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

type StoredVolume = {
  index: number;
  releaseId: number;
  assets: Array<{ id: number; name: string; size: number }>;
};

type StoredFile = {
  fileId: string;
  salt: string;
  manifestAssetId: number;
  manifestReleaseId: number;
  volumes: StoredVolume[];
  name: string;
  size: number;
  type: string;
  modified: string;
  chunkCount: number;
  chunkSize: number;
  volumeCount: number;
};

type DriveFile = {
  id: string;
  name: string;
  type: "video" | "image" | "document" | "archive";
  size: string;
  modified: string;
  source: "remote";
};



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

function fromBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveFileKey(password: string, saltBase64: string) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: fromBase64(saltBase64), iterations: 310000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptBytes(value: ArrayBuffer, key: CryptoKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, value));
  const output = new Uint8Array(iv.length + encrypted.length);
  output.set(iv, 0);
  output.set(encrypted, iv.length);
  return output;
}

async function decryptBytes(value: ArrayBuffer, key: CryptoKey) {
  const input = new Uint8Array(value);
  if (input.length < 28) throw new Error("Encrypted data is incomplete.");
  const iv = input.slice(0, 12);
  const encrypted = input.slice(12);
  return crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, encrypted);
}

function FileGlyph({ type }: { type: DriveFile["type"] }) {
  const common = "h-5 w-5";
  if (type === "video") return <Film className={common + " text-violet-600"} />;
  if (type === "image") return <FileImage className={common + " text-emerald-600"} />;
  if (type === "archive") return <Archive className={common + " text-amber-600"} />;
  return <FileText className={common + " text-blue-600"} />;
}

export default function HomePage() {
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"home" | "files" | "shared" | "settings">("home");
  const [categoryFilter, setCategoryFilter] = useState<"all" | "image" | "video" | "document" | "archive">("all");
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [sortBy, setSortBy] = useState<"recent" | "name" | "size">("recent");
  const [notice, setNotice] = useState("Connect GitHub and select a private repository to start using encrypted storage.");
  const [githubStatus, setGithubStatus] = useState<GitHubStatus>({
    appConfigured: false,
    connected: false,
    user: null,
    storageRepo: null
  });
  const [repositories, setRepositories] = useState<RepoOption[]>([]);
  const [selectedRepo, setSelectedRepo] = useState("");
  const [savingRepo, setSavingRepo] = useState(false);
  const [encryptionPassword, setEncryptionPassword] = useState("");
  const [storageUnlocked, setStorageUnlocked] = useState(false);
  const [remoteFiles, setRemoteFiles] = useState<StoredFile[]>([]);
  const [loadingStorage, setLoadingStorage] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const visibleFiles = useMemo(() => {
    if (!storageUnlocked) return [];
    return remoteFiles
      .map((file) => ({
        id: file.fileId,
        name: file.name,
        type: fileType(file.name),
        size: formatSize(file.size),
        modified: file.modified,
        source: "remote" as const
      }))
      .filter((file) => file.name.toLowerCase().includes(query.toLowerCase()));
  }, [query, remoteFiles, storageUnlocked]);

  const displayFiles = useMemo(() => {
    const filtered = visibleFiles.filter((file) =>
      categoryFilter === "all" || file.type === categoryFilter
    );
    return [...filtered].sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      if (sortBy === "size") return parseFloat(b.size) - parseFloat(a.size);
      return b.modified.localeCompare(a.modified);
    });
  }, [visibleFiles, categoryFilter, sortBy]);

  const totalBytes = useMemo(
    () => remoteFiles.reduce((total, file) => total + file.size, 0),
    [remoteFiles]
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

    const params = new URLSearchParams(window.location.search);
    const authResult = params.get("auth");
    const setupResult = params.get("setup");
    const authMessages: Record<string, string> = {
      connected: "GitHub connected. Now choose a private repository for your files.",
      not_configured: "GitHub App setup is needed. Choose Set up GitHub to start the guided setup.",
      denied: "GitHub authorization was cancelled.",
      invalid_state: "The security check expired. Please connect GitHub again.",
      token_failed: "GitHub did not issue an access token. Please retry the GitHub connection.",
      profile_failed: "GitHub authorized the app, but the profile could not be loaded.",
      callback_failed: "GitHub connection could not be completed. Please try again.",
      failed: "GitHub connection failed. Please try again."
    };
    const setupMessages: Record<string, string> = {
      cancelled: "GitHub App setup was cancelled.",
      invalid_state: "The GitHub App setup security check expired. Start setup again.",
      conversion_failed: "GitHub could not finish creating the app. Please start setup again.",
      incomplete_app: "GitHub returned incomplete app details. Please try setup again.",
      app_missing: "GitHub App setup is not complete yet. Please start setup again."
    };
    if (authResult || setupResult) {
      setNotice(
        (authResult && authMessages[authResult]) ||
        (setupResult && setupMessages[setupResult]) ||
        "GitHub setup returned an unexpected result."
      );
      window.history.replaceState({}, "", window.location.pathname);
    }

    return () => { cancelled = true; };
  }, []);

  async function unlockStorage() {
    if (!githubStatus.storageRepo) {
      setNotice("Connect GitHub and select a private storage repository first.");
      return;
    }
    if (encryptionPassword.length < 10) {
      setNotice("Use a storage password with at least 10 characters. Keep it safe; GitDrive cannot recover it.");
      return;
    }

    setLoadingStorage(true);
    try {
      const response = await fetch("/api/storage/files", { cache: "no-store" });
      const data = await response.json().catch(() => {
        throw new Error("GitDrive storage API returned an unexpected response. Please refresh the app and try again.");
      }) as {
        files?: Array<Omit<StoredFile, "name" | "size" | "type" | "modified" | "chunkCount" | "chunkSize" | "volumeCount">>;
        error?: string
      };
      if (!response.ok || !data.files) throw new Error(data.error ?? "Could not read GitHub storage.");

      const decrypted: StoredFile[] = [];
      for (const entry of data.files) {
        const assetResponse = await fetch(
          `/api/storage/assets/${entry.manifestAssetId}?releaseId=${entry.manifestReleaseId}`,
          { cache: "no-store" }
        );
        if (!assetResponse.ok) throw new Error("Could not download an encrypted file manifest.");
        const key = await deriveFileKey(encryptionPassword, entry.salt);
        const plain = await decryptBytes(await assetResponse.arrayBuffer(), key);
        const manifest = JSON.parse(new TextDecoder().decode(plain)) as {
          name: string;
          size: number;
          type: string;
          modified: string;
          chunkCount: number;
          chunkSize: number;
          volumeCount: number;
          version: number;
        };
        if (manifest.version !== 1 || !manifest.name || !Number.isSafeInteger(manifest.chunkCount)) {
          throw new Error("A stored file manifest is not valid.");
        }
        decrypted.push({ ...entry, ...manifest });
      }

      setRemoteFiles(decrypted.sort((a, b) => b.modified.localeCompare(a.modified)));
      setStorageUnlocked(true);
      setNotice(`Storage unlocked. ${decrypted.length} encrypted file(s) found in ${githubStatus.storageRepo.fullName}.`);
    } catch (error) {
      setStorageUnlocked(false);
      setRemoteFiles([]);
      setNotice(error instanceof Error ? error.message : "Could not unlock storage. Check your password and try again.");
    } finally {
      setLoadingStorage(false);
    }
  }

  async function uploadFile(file: File) {
    if (!githubStatus.storageRepo || !storageUnlocked || encryptionPassword.length < 10) {
      setNotice("Select your private repository and unlock encrypted storage before uploading.");
      return;
    }
    if (uploading) return;

    const chunkSize = 4 * 1024 * 1024;
    const partCount = Math.max(1, Math.ceil(file.size / chunkSize));
    if (partCount > 100000) {
      setNotice("This file is beyond the current upload session limit. Split it into smaller files for now.");
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    let fileId = "";
    const releaseIds: number[] = [];
    try {
      const startResponse = await fetch("/api/storage/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partCount })
      });
      const started = await startResponse.json() as {
        fileId?: string;
        salt?: string;
        releaseId?: number;
        volumeCount?: number;
        error?: string
      };
      if (!startResponse.ok || !started.fileId || !started.salt || !started.releaseId) {
        throw new Error(started.error ?? "Could not start the encrypted upload.");
      }

      fileId = started.fileId;
      releaseIds.push(started.releaseId);
      const key = await deriveFileKey(encryptionPassword, started.salt);

      for (let index = 0; index < partCount; index += 1) {
        const volumeIndex = Math.floor(index / 900);
        if (volumeIndex >= releaseIds.length) {
          const volumeResponse = await fetch(`/api/storage/uploads/${fileId}/volumes`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ index: volumeIndex })
          });
          const volumeData = await volumeResponse.json() as { releaseId?: number; error?: string };
          if (!volumeResponse.ok || !volumeData.releaseId) {
            throw new Error(volumeData.error ?? "Could not create the next storage volume.");
          }
          releaseIds.push(volumeData.releaseId);
        }

        const start = index * chunkSize;
        const plain = await file.slice(start, Math.min(file.size, start + chunkSize)).arrayBuffer();
        const encrypted = await encryptBytes(plain, key);
        const localIndex = index % 900;
        const assetName = `chunk-${String(localIndex).padStart(6, "0")}.gd`;
        const uploadUrl = `/api/storage/uploads/${releaseIds[volumeIndex]}/assets?name=${encodeURIComponent(assetName)}`;

        let uploaded = false;
        let lastError = "Upload failed.";
        for (let attempt = 0; attempt < 3 && !uploaded; attempt += 1) {
          try {
            const uploadResponse = await fetch(uploadUrl, {
              method: "PUT",
              headers: { "Content-Type": "application/octet-stream" },
              body: encrypted
            });
            const uploadData = await uploadResponse.json() as { error?: string };
            if (!uploadResponse.ok) throw new Error(uploadData.error ?? "GitHub rejected this file part.");
            uploaded = true;
          } catch (error) {
            lastError = error instanceof Error ? error.message : "Upload failed.";
          }
        }
        if (!uploaded) throw new Error(`Part ${index + 1} failed: ${lastError}`);
        setUploadProgress(Math.round(((index + 1) / partCount) * 92));
      }

      const manifest = {
        version: 1,
        name: file.name,
        size: file.size,
        type: file.type || "application/octet-stream",
        modified: new Date().toISOString(),
        chunkSize,
        chunkCount: partCount,
        volumeCount: releaseIds.length
      };
      const manifestBytes = await encryptBytes(
        new TextEncoder().encode(JSON.stringify(manifest)).buffer,
        key
      );
      const manifestResponse = await fetch(
        `/api/storage/uploads/${releaseIds[0]}/assets?name=manifest.gd`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/octet-stream" },
          body: manifestBytes
        }
      );
      const manifestResult = await manifestResponse.json() as { error?: string };
      if (!manifestResponse.ok) throw new Error(manifestResult.error ?? "Could not save the encrypted file manifest.");
      setUploadProgress(96);

      const completeResponse = await fetch(`/api/storage/uploads/${fileId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ releaseIds })
      });
      const completeResult = await completeResponse.json() as { error?: string };
      if (!completeResponse.ok) throw new Error(completeResult.error ?? "Could not finish the upload.");

      setUploadProgress(100);
      setNotice(`Encrypted upload complete: ${file.name}`);
      await unlockStorage();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The upload did not complete. Your original file is unchanged.");
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  }

  function addFiles(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    void uploadFile(file);
  }

  async function downloadFile(fileId: string) {
    const file = remoteFiles.find((item) => item.fileId === fileId);
    if (!file || !storageUnlocked) return;
    setNotice(`Preparing download: ${file.name}`);
    try {
      const key = await deriveFileKey(encryptionPassword, file.salt);
      const parts: BlobPart[] = [];
      for (let index = 0; index < file.chunkCount; index += 1) {
        const volumeIndex = Math.floor(index / 900);
        const volume = file.volumes.find((item) => item.index === volumeIndex);
        const localIndex = index % 900;
        const assetName = `chunk-${String(localIndex).padStart(6, "0")}.gd`;
        const asset = volume?.assets.find((item) => item.name === assetName);
        if (!volume || !asset) throw new Error(`Missing encrypted part ${index + 1}.`);

        const response = await fetch(
          `/api/storage/assets/${asset.id}?releaseId=${volume.releaseId}`,
          { cache: "no-store" }
        );
        if (!response.ok) throw new Error(`Could not retrieve part ${index + 1}.`);
        const plain = await decryptBytes(await response.arrayBuffer(), key);
        parts.push(plain);
      }

      const blob = new Blob(parts, { type: file.type || "application/octet-stream" });
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = file.name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
      setNotice(`Download ready: ${file.name}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not decrypt this file. Check your storage password.");
    }
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
      setNotice("Private storage repository linked: " + data.storageRepo.fullName + ". Unlock encrypted storage to start uploading.");
    } catch {
      setNotice("Could not save the storage repository. Please try again.");
    } finally {
      setSavingRepo(false);
    }
  }

  async function disconnectGitHub() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      setGithubStatus((current) => ({ ...current, connected: false, user: null, storageRepo: null }));
      setRepositories([]);
      setSelectedRepo("");
      setNotice("GitHub has been disconnected from this browser session.");
    } catch {
      setNotice("Could not disconnect GitHub. Please try again.");
    }
  }


  function setFilesCategory(category: "all" | "image" | "video" | "document" | "archive") {
    setCategoryFilter(category);
    setActiveTab("files");
  }

  function formatDate(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
  }

  function FileRow({ file, compact = false }: { file: DriveFile; compact?: boolean }) {
    return (
      <div key={file.id} className="flex min-w-0 items-center gap-3 rounded-2xl bg-white px-3 py-3 shadow-[0_2px_12px_rgba(20,24,40,0.035)] ring-1 ring-slate-100">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-violet-50">
          <FileGlyph type={file.type} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-slate-900">{file.name}</p>
          <p className="mt-1 text-[11px] text-slate-500">{file.size}{compact ? "" : " · " + formatDate(file.modified)}</p>
        </div>
        {file.source === "remote" && (
          <button onClick={() => void downloadFile(file.id)} aria-label={"Download " + file.name} className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-violet-600 hover:bg-violet-50">
            <ArrowDownToLine className="h-4 w-4" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f6f7fb] text-slate-900">
      <div className="mx-auto min-h-screen max-w-5xl pb-32">
        <header className="sticky top-0 z-30 border-b border-slate-100 bg-white/95 px-4 py-3 backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-[15px] bg-[#6659e8] text-white shadow-sm">
                <Cloud className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <p className="text-[17px] font-extrabold tracking-tight text-slate-950">GitDrive</p>
                <p className="truncate text-[10px] font-medium text-slate-400">
                  {githubStatus.storageRepo?.fullName ?? "Your private cloud"}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {githubStatus.connected ? (
                <button onClick={() => setActiveTab("settings")} className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-slate-600" aria-label="Open settings">
                  <Settings className="h-[18px] w-[18px]" />
                </button>
              ) : (
                <a href={githubStatus.appConfigured ? "/api/auth/github" : "/api/github-app/register"} className="inline-flex h-10 items-center gap-2 rounded-full bg-[#17172a] px-4 text-xs font-bold text-white">
                  <Link2 className="h-4 w-4" />
                  Connect
                </a>
              )}
              {githubStatus.connected && (
                <span className="grid h-9 w-9 place-items-center rounded-full bg-violet-100 text-xs font-bold text-violet-700">
                  {(githubStatus.user?.login ?? "G").slice(0, 1).toUpperCase()}
                </span>
              )}
            </div>
          </div>
        </header>

        <main className="px-4 pb-10 pt-5 sm:px-6">
          {!githubStatus.connected ? (
            <section className="mb-5 rounded-[26px] bg-white p-5 shadow-sm ring-1 ring-slate-100">
              <div className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-violet-600">
                <ShieldCheck className="h-4 w-4" /> Private by design
              </div>
              <h1 className="text-[25px] font-extrabold leading-tight tracking-tight">Your files, in one simple place.</h1>
              <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">Connect GitHub and choose one of your existing private repositories to create your encrypted drive.</p>
              <a href={githubStatus.appConfigured ? "/api/auth/github" : "/api/github-app/register"} className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#17172a] text-sm font-bold text-white">
                <LogIn className="h-4 w-4" /> {githubStatus.appConfigured ? "Connect GitHub" : "Set up GitHub"}
              </a>
            </section>
          ) : !githubStatus.storageRepo ? (
            <section className="mb-5 rounded-[26px] bg-white p-5 shadow-sm ring-1 ring-slate-100">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-violet-600">
                <HardDrive className="h-4 w-4" /> Choose your storage
              </div>
              <h1 className="mt-2 text-xl font-extrabold tracking-tight">Select a private repository</h1>
              <p className="mt-1 text-xs leading-5 text-slate-500">Use an existing private repository. GitDrive will keep your encrypted file data there.</p>
              {repositories.length > 0 ? (
                <div className="mt-4 flex flex-col gap-3">
                  <select value={selectedRepo} onChange={(e) => setSelectedRepo(e.target.value)} className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-violet-300">
                    {repositories.map((repo) => <option key={repo.id} value={repo.fullName}>{repo.fullName}</option>)}
                  </select>
                  <button onClick={saveStorageRepo} disabled={!selectedRepo || savingRepo} className="h-12 rounded-2xl bg-[#17172a] text-sm font-bold text-white disabled:opacity-50">
                    {savingRepo ? "Saving..." : "Use this repository"}
                  </button>
                </div>
              ) : (
                <div className="mt-4 rounded-2xl bg-amber-50 p-4 text-xs leading-5 text-amber-800">
                  The GitDrive App needs Contents read/write permission on your existing private repository.
                  <a className="mt-2 block font-bold underline" href="https://github.com/settings/installations" target="_blank" rel="noreferrer">Manage GitHub App access</a>
                </div>
              )}
            </section>
          ) : (
            <section className="mb-5 rounded-[26px] bg-white p-4 shadow-sm ring-1 ring-slate-100">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-violet-600">
                    <LockKeyhole className="h-4 w-4" /> Encrypted storage
                  </div>
                  <p className="mt-1 truncate text-xs text-slate-500">{githubStatus.storageRepo.fullName}</p>
                </div>
                <span className={"rounded-full px-3 py-1.5 text-[10px] font-bold " + (storageUnlocked ? "bg-emerald-50 text-emerald-700" : "bg-violet-50 text-violet-700")}>
                  {storageUnlocked ? "Unlocked" : "Locked"}
                </span>
              </div>
              {!storageUnlocked ? (
                <>
                  <div className="mt-4 flex gap-2">
                    <input
                      type="password"
                      autoComplete="current-password"
                      value={encryptionPassword}
                      onChange={(e) => setEncryptionPassword(e.target.value)}
                      placeholder="Enter your storage password"
                      className="h-12 min-w-0 flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-violet-300"
                    />
                    <button onClick={unlockStorage} disabled={loadingStorage || encryptionPassword.length < 10} className="h-12 shrink-0 rounded-2xl bg-[#17172a] px-4 text-xs font-bold text-white disabled:opacity-40">
                      {loadingStorage ? "..." : "Unlock"}
                    </button>
                  </div>
                  <p className="mt-2 text-[10px] leading-4 text-amber-700">Keep this password safe. It cannot be reset to recover encrypted files.</p>
                </>
              ) : (
                <div className="mt-3 flex items-center justify-between rounded-2xl bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
                  <span className="flex items-center gap-2"><Check className="h-4 w-4" /> Storage unlocked</span>
                  <button onClick={() => { setStorageUnlocked(false); setRemoteFiles([]); }} className="text-emerald-800 underline">Lock</button>
                </div>
              )}
              {uploading && (
                <div className="mt-4">
                  <div className="flex justify-between text-[11px] text-slate-500"><span>Encrypting and uploading</span><span>{uploadProgress}%</span></div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-violet-500 transition-all" style={{ width: uploadProgress + "%" }} /></div>
                </div>
              )}
            </section>
          )}

          {notice && (
            <div className="mb-5 flex items-start gap-2 rounded-2xl bg-violet-50 px-3 py-3 text-xs leading-5 text-violet-900 ring-1 ring-violet-100">
              <Cloud className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="min-w-0 flex-1">{notice}</p>
              <button onClick={() => setNotice("")} aria-label="Dismiss notice" className="shrink-0 text-violet-500"><X className="h-4 w-4" /></button>
            </div>
          )}

          {activeTab === "home" && (
            <>
              <section className="mb-5">
                <p className="text-xs font-semibold text-violet-600">YOUR PERSONAL DRIVE</p>
                <h1 className="mt-1 text-[26px] font-extrabold leading-tight tracking-tight">
                  Hello{githubStatus.user?.name ? ", " + githubStatus.user.name.split(" ")[0] : ""}
                </h1>
                <p className="mt-1 text-sm text-slate-500">Everything you save, neatly together.</p>
              </section>

              <section className="mb-5 overflow-hidden rounded-[28px] bg-gradient-to-br from-[#5b50d8] via-[#675ce9] to-[#8578f4] p-5 text-white shadow-[0_14px_35px_rgba(91,80,216,0.22)]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium text-violet-100">Your private storage</p>
                    <p className="mt-2 text-[28px] font-extrabold tracking-tight">{storageUnlocked ? `${remoteFiles.length} files` : "Storage locked"}</p>
                    <p className="mt-1 text-xs text-violet-100">{storageUnlocked ? formatSize(totalBytes) + " stored" : "Unlock to view your storage"}</p>
                  </div>
                  <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/15"><HardDrive className="h-6 w-6" /></span>
                </div>
                <div className="mt-5 flex items-center justify-between border-t border-white/20 pt-3 text-[11px] text-violet-100">
                  <span>{githubStatus.storageRepo?.fullName ?? "GitHub not connected"}</span>
                  <button onClick={() => setActiveTab("settings")} className="flex items-center gap-1 font-bold text-white">Manage <ChevronRight className="h-3 w-3" /></button>
                </div>
              </section>

              <section className="mb-6">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-[15px] font-extrabold">Quick access</h2>
                  <button onClick={() => setActiveTab("files")} className="text-xs font-bold text-violet-600">See all</button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <button onClick={() => setFilesCategory("all")} className="flex items-center gap-3 rounded-[22px] bg-white p-4 text-left shadow-sm ring-1 ring-slate-100">
                    <span className="grid h-10 w-10 place-items-center rounded-2xl bg-violet-50 text-violet-600"><FolderOpen className="h-5 w-5" /></span>
                    <span><span className="block text-xs font-bold">All files</span><span className="mt-1 block text-[10px] text-slate-400">{storageUnlocked ? `${remoteFiles.length} items` : "Unlock to view"}</span></span>
                  </button>
                  <button onClick={() => setFilesCategory("image")} className="flex items-center gap-3 rounded-[22px] bg-white p-4 text-left shadow-sm ring-1 ring-slate-100">
                    <span className="grid h-10 w-10 place-items-center rounded-2xl bg-emerald-50 text-emerald-600"><ImageIcon className="h-5 w-5" /></span>
                    <span><span className="block text-xs font-bold">Images</span><span className="mt-1 block text-[10px] text-slate-400">{storageUnlocked ? `${remoteFiles.filter((f) => fileType(f.name) === "image").length} items` : "Unlock to view"}</span></span>
                  </button>
                  <button onClick={() => setFilesCategory("video")} className="flex items-center gap-3 rounded-[22px] bg-white p-4 text-left shadow-sm ring-1 ring-slate-100">
                    <span className="grid h-10 w-10 place-items-center rounded-2xl bg-amber-50 text-amber-600"><Film className="h-5 w-5" /></span>
                    <span><span className="block text-xs font-bold">Videos</span><span className="mt-1 block text-[10px] text-slate-400">{storageUnlocked ? `${remoteFiles.filter((f) => fileType(f.name) === "video").length} items` : "Unlock to view"}</span></span>
                  </button>
                  <button onClick={() => setFilesCategory("document")} className="flex items-center gap-3 rounded-[22px] bg-white p-4 text-left shadow-sm ring-1 ring-slate-100">
                    <span className="grid h-10 w-10 place-items-center rounded-2xl bg-sky-50 text-sky-600"><FileText className="h-5 w-5" /></span>
                    <span><span className="block text-xs font-bold">Documents</span><span className="mt-1 block text-[10px] text-slate-400">{storageUnlocked ? `${remoteFiles.filter((f) => fileType(f.name) === "document").length} items` : "Unlock to view"}</span></span>
                  </button>
                </div>
              </section>

              <section>
                <div className="mb-3 flex items-center justify-between">
                  <div><h2 className="text-[15px] font-extrabold">Recent files</h2><p className="mt-1 text-[10px] text-slate-400">Your latest uploads</p></div>
                  <button onClick={() => setActiveTab("files")} className="text-xs font-bold text-violet-600">View all</button>
                </div>
                {storageUnlocked && displayFiles.length > 0 ? (
                  <div className="space-y-2">{displayFiles.slice(0, 5).map((file) => <FileRow key={file.id} file={file} />)}</div>
                ) : (
                  <div className="rounded-[24px] bg-white px-5 py-8 text-center shadow-sm ring-1 ring-slate-100">
                    <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-violet-50 text-violet-600"><FolderOpen className="h-6 w-6" /></span>
                    <p className="mt-3 text-sm font-bold">{storageUnlocked ? "Your drive is empty" : "Your files will appear here"}</p>
                    <p className="mx-auto mt-1 max-w-xs text-xs leading-5 text-slate-500">{storageUnlocked ? "Upload your first file to get started." : "Unlock encrypted storage to browse your private files."}</p>
                    {storageUnlocked && <button onClick={() => inputRef.current?.click()} className="mt-4 inline-flex h-10 items-center gap-2 rounded-xl bg-[#17172a] px-4 text-xs font-bold text-white"><Plus className="h-4 w-4" /> Add your first file</button>}
                  </div>
                )}
              </section>
            </>
          )}

          {activeTab === "files" && (
            <section>
              <div className="mb-4">
                <p className="text-xs font-semibold text-violet-600">YOUR LIBRARY</p>
                <div className="mt-1 flex items-end justify-between gap-2">
                  <div><h1 className="text-[26px] font-extrabold tracking-tight">My files</h1><p className="mt-1 text-xs text-slate-500">{storageUnlocked ? displayFiles.length + " files" : "Unlock storage to browse files"}</p></div>
                  <div className="flex items-center gap-1 rounded-xl bg-white p-1 ring-1 ring-slate-100">
                    <button onClick={() => setViewMode("list")} className={"grid h-9 w-9 place-items-center rounded-lg " + (viewMode === "list" ? "bg-violet-100 text-violet-700" : "text-slate-400")} aria-label="List view"><List className="h-4 w-4" /></button>
                    <button onClick={() => setViewMode("grid")} className={"grid h-9 w-9 place-items-center rounded-lg " + (viewMode === "grid" ? "bg-violet-100 text-violet-700" : "text-slate-400")} aria-label="Grid view"><LayoutGrid className="h-4 w-4" /></button>
                  </div>
                </div>
              </div>
              <div className="mb-4 flex h-12 items-center gap-2 rounded-2xl bg-white px-4 shadow-sm ring-1 ring-slate-100">
                <Search className="h-4 w-4 shrink-0 text-slate-400" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search files and folders" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400" />
                <SlidersHorizontal className="h-4 w-4 shrink-0 text-slate-400" />
              </div>
              <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
                {([
                  ["all", "All"],
                  ["image", "Images"],
                  ["video", "Videos"],
                  ["document", "Documents"],
                  ["archive", "Archives"]
                ] as const).map(([value, label]) => (
                  <button key={value} onClick={() => setCategoryFilter(value)} className={"shrink-0 rounded-full px-4 py-2 text-xs font-bold " + (categoryFilter === value ? "bg-[#6659e8] text-white" : "bg-white text-slate-500 ring-1 ring-slate-100")}>{label}</button>
                ))}
              </div>
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[11px] font-semibold text-slate-500">{displayFiles.length} items</span>
                <label className="flex items-center gap-2 text-[11px] font-semibold text-slate-500">
                  <ArrowDownToLine className="h-3.5 w-3.5" />
                  <select value={sortBy} onChange={(e) => setSortBy(e.target.value as "recent" | "name" | "size")} className="bg-transparent outline-none">
                    <option value="recent">Recent first</option>
                    <option value="name">Name A–Z</option>
                    <option value="size">Largest first</option>
                  </select>
                </label>
              </div>
              {!storageUnlocked ? (
                <div className="rounded-[24px] bg-white px-5 py-9 text-center shadow-sm ring-1 ring-slate-100">
                  <LockKeyhole className="mx-auto h-8 w-8 text-violet-500" />
                  <p className="mt-3 text-sm font-bold">Storage is locked</p>
                  <p className="mt-1 text-xs text-slate-500">Enter your storage password above to see your files.</p>
                </div>
              ) : displayFiles.length === 0 ? (
                <div className="rounded-[24px] bg-white px-5 py-10 text-center shadow-sm ring-1 ring-slate-100">
                  <FolderOpen className="mx-auto h-9 w-9 text-violet-400" />
                  <p className="mt-3 text-sm font-bold">No files found</p>
                  <p className="mt-1 text-xs text-slate-500">Upload a file or change your search/filter.</p>
                </div>
              ) : viewMode === "list" ? (
                <div className="space-y-2">{displayFiles.map((file) => <FileRow key={file.id} file={file} />)}</div>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{displayFiles.map((file) => (
                  <div key={file.id} className="rounded-[22px] bg-white p-3 shadow-sm ring-1 ring-slate-100">
                    <div className="flex h-24 items-center justify-center rounded-2xl bg-violet-50"><FileGlyph type={file.type} /></div>
                    <p className="mt-3 truncate text-xs font-bold">{file.name}</p>
                    <p className="mt-1 text-[10px] text-slate-500">{file.size}</p>
                    <button onClick={() => void downloadFile(file.id)} className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-xl bg-slate-900 text-[11px] font-bold text-white"><ArrowDownToLine className="h-3.5 w-3.5" /> Download</button>
                  </div>
                ))}</div>
              )}
            </section>
          )}

          {activeTab === "settings" && (
            <section className="space-y-4">
              <div><p className="text-xs font-semibold text-violet-600">PREFERENCES</p><h1 className="mt-1 text-[26px] font-extrabold">Settings</h1></div>
              <div className="rounded-[24px] bg-white p-4 shadow-sm ring-1 ring-slate-100">
                <p className="text-sm font-bold">GitHub account</p>
                <p className="mt-1 text-xs text-slate-500">{githubStatus.user?.login ?? "Not connected"}</p>
                {githubStatus.connected && <button onClick={() => void disconnectGitHub()} className="mt-4 h-10 rounded-xl border border-slate-200 px-4 text-xs font-bold text-slate-700">Disconnect GitHub</button>}
              </div>
              {githubStatus.connected && (
                <div className="rounded-[24px] bg-white p-4 shadow-sm ring-1 ring-slate-100">
                  <p className="text-sm font-bold">Storage repository</p>
                  <p className="mt-1 text-xs text-slate-500">Choose an existing private repository that the GitDrive App can write to.</p>
                  {repositories.length > 0 ? (
                    <div className="mt-3 space-y-3">
                      <select value={selectedRepo} onChange={(e) => setSelectedRepo(e.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs outline-none">
                        {repositories.map((repo) => <option key={repo.id} value={repo.fullName}>{repo.fullName}</option>)}
                      </select>
                      <button onClick={saveStorageRepo} disabled={!selectedRepo || savingRepo} className="h-11 w-full rounded-xl bg-[#17172a] text-xs font-bold text-white disabled:opacity-50">{savingRepo ? "Saving..." : "Save repository"}</button>
                    </div>
                  ) : <a href="https://github.com/settings/installations" target="_blank" rel="noreferrer" className="mt-3 inline-flex text-xs font-bold text-violet-600 underline">Manage GitHub App access</a>}
                </div>
              )}
              <div className="rounded-[24px] bg-white p-4 shadow-sm ring-1 ring-slate-100">
                <div className="flex items-center gap-2 text-sm font-bold"><ShieldCheck className="h-4 w-4 text-emerald-600" /> Encryption</div>
                <p className="mt-2 text-xs leading-5 text-slate-500">Files are encrypted on this device with AES-256-GCM before being uploaded. Your storage password is never sent to GitDrive.</p>
              </div>
            </section>
          )}
        </main>
      </div>

      {storageUnlocked && (
        <button onClick={() => inputRef.current?.click()} disabled={uploading} className="fixed bottom-[92px] right-5 z-40 inline-flex h-14 items-center gap-3 rounded-full bg-[#17172a] px-5 text-sm font-bold text-white shadow-[0_8px_24px_rgba(20,20,40,0.22)] disabled:opacity-50">
          {uploading ? <CloudUpload className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
          {uploading ? "Uploading" : "Add files"}
        </button>
      )}

      <input ref={inputRef} type="file" className="hidden" onChange={(e) => { addFiles(e.target.files); e.currentTarget.value = ""; }} />

      <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-slate-200 bg-white/95 px-2 pb-[max(env(safe-area-inset-bottom),8px)] pt-2 backdrop-blur">
        <div className="mx-auto grid max-w-lg grid-cols-3">
          {([
            ["home", "Home", Home],
            ["files", "Files", FolderOpen],
            ["settings", "Settings", Settings]
          ] as const).map(([tab, label, Icon]) => (
            <button key={tab} onClick={() => setActiveTab(tab)} className={"flex min-h-[54px] flex-col items-center justify-center gap-1 rounded-2xl text-[10px] font-bold " + (activeTab === tab ? "text-violet-700" : "text-slate-400")}>
              <span className={"grid h-7 w-12 place-items-center rounded-full " + (activeTab === tab ? "bg-violet-100" : "")}><Icon className="h-[19px] w-[19px]" /></span>
              {label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}