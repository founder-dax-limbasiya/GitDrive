import { NextResponse } from "next/server";
import { getGitDriveSession, getValidGitHubAccessToken } from "@/lib/github-session";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await getGitDriveSession();
    const appConfigured = Boolean(
      (session.appClientId && session.appClientSecret) ||
      (process.env.GITHUB_APP_CLIENT_ID && process.env.GITHUB_APP_CLIENT_SECRET)
    );
    const accessToken = await getValidGitHubAccessToken(session);
    return NextResponse.json(
      {
        appConfigured,
        connected: Boolean(accessToken && session.githubUser),
        user: session.githubUser ?? null,
        storageRepo: session.storageRepo ?? null
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json(
      { appConfigured: false, connected: false, user: null, storageRepo: null },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}
