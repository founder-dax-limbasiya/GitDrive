import { cookies } from "next/headers";
import { getIronSession } from "iron-session";

export type GitHubUser = {
  login: string;
  avatarUrl: string;
  name: string | null;
};

export type SelectedStorageRepo = {
  id: number;
  fullName: string;
  name: string;
  owner: string;
  defaultBranch: string;
};

export type GitDriveSession = {
  accessToken?: string;
  refreshToken?: string;
  accessTokenExpiresAt?: number;
  refreshTokenExpiresAt?: number;
  githubUser?: GitHubUser;
  storageRepo?: SelectedStorageRepo;
  appClientId?: string;
  appClientSecret?: string;
  appSlug?: string;
};

const SESSION_COOKIE = "gitdrive_session";
const API_VERSION = "2022-11-28";

export async function getGitDriveSession() {
  const password = process.env.GITDRIVE_SESSION_PASSWORD;
  if (!password || password.length < 32) {
    throw new Error("GITDRIVE_SESSION_PASSWORD must be set to at least 32 characters.");
  }

  return getIronSession<GitDriveSession>(await cookies(), {
    cookieName: SESSION_COOKIE,
    password,
    ttl: 60 * 60 * 24 * 180,
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 180
    }
  });
}

export async function getValidGitHubAccessToken(session: Awaited<ReturnType<typeof getGitDriveSession>>) {
  if (!session.accessToken) return null;

  const expiresAt = session.accessTokenExpiresAt;
  if (!expiresAt || expiresAt > Date.now() + 60_000) return session.accessToken;

  if (!session.refreshToken) {
    session.accessToken = undefined;
    session.accessTokenExpiresAt = undefined;
    session.githubUser = undefined;
    session.storageRepo = undefined;
    await session.save();
    return null;
  }

  const clientId = session.appClientId ?? process.env.GITHUB_APP_CLIENT_ID;
  const clientSecret = session.appClientSecret ?? process.env.GITHUB_APP_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: session.refreshToken
  });

  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body,
    cache: "no-store"
  });

  if (!response.ok) return null;

  const data = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    refresh_token_expires_in?: number;
    error?: string;
  };

  if (!data.access_token) {
    session.accessToken = undefined;
    session.refreshToken = undefined;
    session.accessTokenExpiresAt = undefined;
    session.refreshTokenExpiresAt = undefined;
    session.githubUser = undefined;
    session.storageRepo = undefined;
    await session.save();
    return null;
  }

  session.accessToken = data.access_token;
  session.accessTokenExpiresAt = data.expires_in ? Date.now() + data.expires_in * 1000 : undefined;
  session.refreshToken = data.refresh_token ?? session.refreshToken;
  session.refreshTokenExpiresAt = data.refresh_token_expires_in
    ? Date.now() + data.refresh_token_expires_in * 1000
    : session.refreshTokenExpiresAt;
  await session.save();

  return session.accessToken;
}

export async function githubApiFetch(path: string, accessToken: string, init: RequestInit = {}) {
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "X-GitHub-Api-Version": API_VERSION,
      ...(init.headers ?? {})
    },
    cache: "no-store"
  });
}
