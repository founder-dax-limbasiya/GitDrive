import { getGitDriveSession, getValidGitHubAccessToken, githubApiFetch } from "@/lib/github-session";

export const GITDRIVE_CHUNK_BYTES = 4 * 1024 * 1024;
export const GITDRIVE_ASSETS_PER_VOLUME = 900;
export const GITDRIVE_MAX_PARTS = 100_000;

export type StorageContext = {
  token: string;
  owner: string;
  repo: string;
  defaultBranch: string;
  basePath: string;
};

export async function getStorageContext(): Promise<StorageContext | null> {
  const session = await getGitDriveSession();
  const token = await getValidGitHubAccessToken(session);
  const selected = session.storageRepo;
  if (!token || !selected) return null;

  return {
    token,
    owner: selected.owner,
    repo: selected.name,
    defaultBranch: selected.defaultBranch,
    basePath: `/repos/${encodeURIComponent(selected.owner)}/${encodeURIComponent(selected.name)}`
  };
}

export function parseReleaseBody(body: string | null | undefined) {
  const values: Record<string, string> = {};
  for (const line of (body ?? "").split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index > 0) values[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return values;
}

export function buildReleaseBody(input: {
  fileId: string;
  volume: number;
  partCount: number;
  salt: string;
  status: "pending" | "complete";
}) {
  return [
    "gitdrive=1",
    `file_id=${input.fileId}`,
    `volume=${input.volume}`,
    `part_count=${input.partCount}`,
    `salt=${input.salt}`,
    `status=${input.status}`
  ].join("\n");
}

export async function getRelease(context: StorageContext, releaseId: number | string) {
  return githubApiFetch(`${context.basePath}/releases/${releaseId}`, context.token);
}

export async function listReleaseAssets(context: StorageContext, releaseId: number | string) {
  const assets: Array<{ id: number; name: string; size: number; state: string }> = [];
  for (let page = 1; page <= 10; page += 1) {
    const response = await githubApiFetch(
      `${context.basePath}/releases/${releaseId}/assets?per_page=100&page=${page}`,
      context.token
    );
    if (!response.ok) throw new Error("Could not list release assets.");
    const items = (await response.json()) as Array<{ id: number; name: string; size: number; state: string }>;
    assets.push(...items);
    if (items.length < 100) break;
  }
  return assets;
}

export async function createStorageRelease(
  context: StorageContext,
  input: { fileId: string; volume: number; partCount: number; salt: string }
) {
  const tagName = `gitdrive-file-${input.fileId}-v${input.volume}`;
  const existing = await githubApiFetch(`${context.basePath}/releases/tags/${tagName}`, context.token);
  if (existing.ok) {
    const release = await existing.json() as { id: number; draft: boolean; body: string | null; tag_name: string };
    const values = parseReleaseBody(release.body);
    if (release.draft && values.gitdrive === "1" && values.file_id === input.fileId && Number(values.volume) === input.volume) {
      return release;
    }
    throw new Error("A release with this GitDrive file identifier already exists.");
  }

  const response = await githubApiFetch(`${context.basePath}/releases`, context.token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tag_name: tagName,
      name: "GitDrive encrypted data",
      body: buildReleaseBody({ ...input, status: "pending" }),
      draft: true,
      prerelease: false,
      target_commitish: context.defaultBranch
    })
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`GitHub could not create the storage release (${response.status}): ${detail.slice(0, 250)}`);
  }
  return response.json() as Promise<{ id: number; tag_name: string; draft: boolean; body: string; upload_url: string }>;
}

export async function uploadStorageAsset(
  context: StorageContext,
  releaseId: number | string,
  name: string,
  data: ArrayBuffer | Uint8Array
) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const uploadBody = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(uploadBody).set(bytes);
  const releaseResponse = await getRelease(context, releaseId);
  if (!releaseResponse.ok) throw new Error("Could not verify the GitHub storage release.");
  const release = await releaseResponse.json() as { upload_url?: string };
  if (!release.upload_url) throw new Error("GitHub did not provide a release asset upload URL.");
  const uploadUrl = new URL(release.upload_url.replace(/\\{[^}]+\\}$/, ""));
  uploadUrl.searchParams.set("name", name);

  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${context.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/octet-stream",
      "Content-Length": String(bytes.byteLength)
    },
    body: uploadBody,
    cache: "no-store"
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`GitHub asset upload failed (${response.status}): ${detail.slice(0, 250)}`);
  }
  return response.json() as Promise<{ id: number; name: string; size: number; state: string }>;
}

export function isGitDriveRelease(release: { tag_name?: string; body?: string | null; draft?: boolean }) {
  const values = parseReleaseBody(release.body);
  return (
    Boolean(release.tag_name?.startsWith("gitdrive-file-")) &&
    values.gitdrive === "1"
  );
}
