import { NextResponse } from "next/server";
import {
  createStorageRelease,
  getStorageContext,
  parseReleaseBody
} from "@/lib/github-storage";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(
  request: Request,
  contextParams: { params: Promise<{ fileId: string }> }
) {
  try {
    const context = await getStorageContext();
    if (!context) return NextResponse.json({ error: "Connect GitHub and select a storage repository first." }, { status: 401 });

    const { fileId } = await contextParams.params;
    if (!/^[0-9a-f-]{36}$/i.test(fileId)) return NextResponse.json({ error: "Invalid file identifier." }, { status: 400 });

    const body = await request.json() as { index?: number };
    const index = body.index;
    if (!Number.isSafeInteger(index) || !index || index < 1 || index > 1000) {
      return NextResponse.json({ error: "Invalid release volume." }, { status: 400 });
    }

    const previousTag = `gitdrive-file-${fileId}-v${index - 1}`;
    const previousResponse = await fetch(
      `https://api.github.com${context.basePath}/releases/tags/${previousTag}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${context.token}`,
          "X-GitHub-Api-Version": "2022-11-28"
        },
        cache: "no-store"
      }
    );
    if (!previousResponse.ok) return NextResponse.json({ error: "Previous upload volume was not found." }, { status: 404 });
    const previous = await previousResponse.json() as { id: number; draft: boolean; body: string | null };
    const metadata = parseReleaseBody(previous.body);
    if (!previous.draft || metadata.gitdrive !== "1" || metadata.file_id !== fileId || !metadata.salt || !metadata.part_count) {
      return NextResponse.json({ error: "Previous upload volume is not a pending GitDrive upload." }, { status: 409 });
    }

    const partCount = Number(metadata.part_count);
    const maxVolumes = Math.ceil(partCount / 900);
    if (index >= maxVolumes) return NextResponse.json({ error: "Requested volume exceeds the file's chunk count." }, { status: 400 });

    const release = await createStorageRelease(context, {
      fileId,
      volume: index,
      partCount,
      salt: metadata.salt
    });

    return NextResponse.json({ releaseId: release.id, volume: index }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create upload volume.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
