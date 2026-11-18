import { NextResponse } from "next/server";
import { getGitDriveSession, getValidGitHubAccessToken, githubApiFetch } from "@/lib/github-session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  try {
    const session = await getGitDriveSession();
    const token = await getValidGitHubAccessToken(session);
    if (!token) return NextResponse.json({ error: "Connect GitHub first." }, { status: 401 });

    const body = (await request.json()) as { fullName?: string };
    const fullName = body.fullName?.trim() ?? "";
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName)) {
      return NextResponse.json({ error: "Choose a valid repository." }, { status: 400 });
    }

    const response = await githubApiFetch(`/repos/${fullName}`, token);
    if (!response.ok) {
      return NextResponse.json({ error: "GitHub could not verify this repository. It may not be included in the app installation." }, { status: response.status });
    }

    const repo = (await response.json()) as {
      id: number;
      name: string;
      full_name: string;
      owner: { login: string };
      private: boolean;
      default_branch: string;
      permissions?: { push?: boolean };
    };

    if (!repo.private) {
      return NextResponse.json({ error: "For privacy, GitDrive storage must use a private repository." }, { status: 400 });
    }
    if (!repo.permissions?.push) {
      return NextResponse.json({ error: "The connected GitHub App needs write access to this repository." }, { status: 403 });
    }

    session.storageRepo = {
      id: repo.id,
      fullName: repo.full_name,
      name: repo.name,
      owner: repo.owner.login,
      defaultBranch: repo.default_branch
    };
    await session.save();

    return NextResponse.json({ ok: true, storageRepo: session.storageRepo }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not save the storage repository." }, { status: 500 });
  }
}
