import { NextResponse } from "next/server";
import { getGitDriveSession, getValidGitHubAccessToken, githubApiFetch } from "@/lib/github-session";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await getGitDriveSession();
    const token = await getValidGitHubAccessToken(session);
    if (!token) return NextResponse.json({ error: "Connect GitHub first." }, { status: 401 });

    const response = await githubApiFetch(
      "/user/repos?visibility=private&affiliation=owner&per_page=100&sort=updated",
      token
    );
    if (!response.ok) {
      return NextResponse.json({ error: "Could not list repositories. Check your GitHub App permissions." }, { status: response.status });
    }

    const repos = (await response.json()) as Array<{
      id: number;
      name: string;
      full_name: string;
      private: boolean;
      description: string | null;
      default_branch: string;
      permissions?: { push?: boolean };
    }>;

    return NextResponse.json({
      repositories: repos
        .filter((repo) => repo.private && repo.permissions?.push)
        .map((repo) => ({
          id: repo.id,
          name: repo.name,
          fullName: repo.full_name,
          description: repo.description,
          defaultBranch: repo.default_branch
        }))
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "GitHub connection is not configured." }, { status: 503 });
  }
}
