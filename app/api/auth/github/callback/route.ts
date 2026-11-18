import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getGitDriveSession, githubApiFetch } from "@/lib/github-session";

export const runtime = "nodejs";

function returnToApp(request: Request, result: string) {
  const url = new URL("/", request.url);
  url.searchParams.set("auth", result);
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieStore = await cookies();
  const savedState = cookieStore.get("gitdrive_oauth_state")?.value;
  const verifier = cookieStore.get("gitdrive_oauth_verifier")?.value;

  const clearOAuthCookies = (response: NextResponse) => {
    response.cookies.set("gitdrive_oauth_state", "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
    response.cookies.set("gitdrive_oauth_verifier", "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
    return response;
  };

  if (url.searchParams.has("error")) return clearOAuthCookies(returnToApp(request, "denied"));
  if (!code || !state || !savedState || state !== savedState || !verifier) {
    return clearOAuthCookies(returnToApp(request, "invalid_state"));
  }

  const redirectUri = process.env.GITHUB_APP_REDIRECT_URI;
  let session;
  try {
    session = await getGitDriveSession();
  } catch {
    return clearOAuthCookies(returnToApp(request, "not_configured"));
  }
  const clientId = session.appClientId ?? process.env.GITHUB_APP_CLIENT_ID;
  const clientSecret = session.appClientSecret ?? process.env.GITHUB_APP_CLIENT_SECRET;
  if (!clientId || !clientSecret || !redirectUri) {
    return clearOAuthCookies(returnToApp(request, "not_configured"));
  }

  try {
    const tokenBody = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier
    });

    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody,
      cache: "no-store"
    });

    const tokenData = (await tokenResponse.json()) as {
      access_token?: string;
      expires_in?: number;
      refresh_token?: string;
      refresh_token_expires_in?: number;
      error?: string;
    };

    if (!tokenResponse.ok || !tokenData.access_token) {
      return clearOAuthCookies(returnToApp(request, "token_failed"));
    }

    const userResponse = await githubApiFetch("/user", tokenData.access_token);
    if (!userResponse.ok) return clearOAuthCookies(returnToApp(request, "profile_failed"));

    const user = (await userResponse.json()) as { login: string; avatar_url: string; name: string | null };
    session.accessToken = tokenData.access_token;
    session.refreshToken = tokenData.refresh_token;
    session.accessTokenExpiresAt = tokenData.expires_in ? Date.now() + tokenData.expires_in * 1000 : undefined;
    session.refreshTokenExpiresAt = tokenData.refresh_token_expires_in
      ? Date.now() + tokenData.refresh_token_expires_in * 1000
      : undefined;
    session.githubUser = {
      login: user.login,
      avatarUrl: user.avatar_url,
      name: user.name ?? null
    };
    session.storageRepo = undefined;
    await session.save();

    return clearOAuthCookies(returnToApp(request, "connected"));
  } catch {
    return clearOAuthCookies(returnToApp(request, "callback_failed"));
  }
}
