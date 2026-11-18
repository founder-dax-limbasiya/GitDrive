import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getGitDriveSession } from "@/lib/github-session";

export const runtime = "nodejs";

function backToApp(request: Request, result: string) {
  const url = new URL("/", request.url);
  url.searchParams.set("setup", result);
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieStore = await cookies();
  const savedState = cookieStore.get("gitdrive_manifest_state")?.value;

  const clearState = (response: NextResponse) => {
    response.cookies.set("gitdrive_manifest_state", "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0
    });
    return response;
  };

  if (url.searchParams.has("error")) return clearState(backToApp(request, "cancelled"));
  if (!code || !state || !savedState || state !== savedState) {
    return clearState(backToApp(request, "invalid_state"));
  }

  try {
    const conversion = await fetch(
      `https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28"
        },
        cache: "no-store"
      }
    );

    if (!conversion.ok) {
      return clearState(backToApp(request, "conversion_failed"));
    }

    const app = (await conversion.json()) as {
      id?: number;
      slug?: string;
      client_id?: string;
      client_secret?: string;
      html_url?: string;
    };

    const slug = app.slug ?? app.html_url?.split("/").filter(Boolean).pop();
    if (!app.client_id || !app.client_secret || !slug || !app.id) {
      return clearState(backToApp(request, "incomplete_app"));
    }

    const session = await getGitDriveSession();
    session.appClientId = app.client_id;
    session.appClientSecret = app.client_secret;
    session.appSlug = slug;
    session.accessToken = undefined;
    session.refreshToken = undefined;
    session.accessTokenExpiresAt = undefined;
    session.refreshTokenExpiresAt = undefined;
    session.githubUser = undefined;
    session.storageRepo = undefined;
    await session.save();

    const installUrl = new URL(`https://github.com/apps/${encodeURIComponent(slug)}/installations/new`);
    return clearState(NextResponse.redirect(installUrl));
  } catch {
    return clearState(backToApp(request, "conversion_failed"));
  }
}
