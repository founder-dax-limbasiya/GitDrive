import { randomBytes, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createStorageRelease, GITDRIVE_MAX_PARTS, getStorageContext } from "@/lib/github-storage";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const context = await getStorageContext();
    if (!context) return NextResponse.json({ error: "Connect GitHub and select a private storage repository first." }, { status: 401 });

    const body = await request.json() as { partCount?: number };
    const partCount = body.partCount;
    if (!Number.isSafeInteger(partCount) || !partCount || partCount < 1 || partCount > GITDRIVE_MAX_PARTS) {
      return NextResponse.json({ error: "Invalid file size or chunk count." }, { status: 400 });
    }

    const fileId = randomUUID();
    const salt = randomBytes(16).toString("base64");
    const release = await createStorageRelease(context, { fileId, volume: 0, partCount, salt });

    return NextResponse.json({
      fileId,
      salt,
      partCount,
      volumeSize: 900,
      releaseId: release.id,
      volumeCount: Math.ceil(partCount / 900)
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start upload.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
