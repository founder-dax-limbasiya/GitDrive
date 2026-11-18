import { NextResponse } from "next/server";
import { getGitDriveSession } from "@/lib/github-session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  try {
    const session = await getGitDriveSession();
    session.destroy();
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Session is not configured." }, { status: 503 });
  }
}
