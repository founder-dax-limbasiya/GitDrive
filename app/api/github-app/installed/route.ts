import { NextResponse } from "next/server";
import { getGitDriveSession } from "@/lib/github-session";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const session = await getGitDriveSession();
    if (!session.appClientId || !session.appClientSecret) {
      return NextResponse.redirect(new URL("/?setup=app_missing", request.url));
    }
    return NextResponse.redirect(new URL("/api/auth/github", request.url));
  } catch {
    return NextResponse.redirect(new URL("/?setup=app_missing", request.url));
  }
}
