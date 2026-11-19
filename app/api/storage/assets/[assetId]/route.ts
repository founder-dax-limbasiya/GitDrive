import { NextResponse } from "next/server";
import { getRelease, getStorageContext, listReleaseAssets } from "@/lib/github-storage";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(
  request: Request,
  contextParams: { params: Promise<{ assetId: string }> }
) {
  try {
    const context = await getStorageContext();
    if (!context) return NextResponse.json({ error: "Connect GitHub and select a storage repository first." }, { status: 401 });

    const { assetId } = await contextParams.params;
    const releaseId = new URL(request.url).searchParams.get("releaseId");
    if (!/^\d+$/.test(assetId) || !releaseId || !/^\d+$/.test(releaseId)) {
      return NextResponse.json({ error: "Invalid release asset." }, { status: 400 });
    }

    const releaseResponse = await getRelease(context, releaseId);
    if (!releaseResponse.ok) return NextResponse.json({ error: "Storage release not found." }, { status: 404 });
    const release = await releaseResponse.json() as { id: number; tag_name: string; body: string | null; draft: boolean };
    if (release.draft || !release.tag_name.startsWith("gitdrive-file-")) {
      return NextResponse.json({ error: "This is not a published GitDrive file release." }, { status: 404 });
    }

    const fileIdMatch = release.tag_name.match(/^gitdrive-file-([0-9a-f-]{36})-v\\d+$/i);
    if (!fileIdMatch) return NextResponse.json({ error: "Invalid GitDrive file release." }, { status: 404 });
    const indexResponse = await fetch(
      `https://api.github.com${context.basePath}/releases/tags/gitdrive-file-${fileIdMatch[1]}-v0`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${context.token}`,
          "X-GitHub-Api-Version": "2022-11-28"
        },
        cache: "no-store"
      }
    );
    if (!indexResponse.ok) return NextResponse.json({ error: "This file has not been finalized." }, { status: 404 });
    const indexRelease = await indexResponse.json() as { draft: boolean; body: string | null };
    const indexMetadata = indexRelease.body ?? "";
    if (indexRelease.draft || !indexMetadata.includes("status=complete")) {
      return NextResponse.json({ error: "This file has not been finalized." }, { status: 404 });
    }

    const assets = await listReleaseAssets(context, releaseId);
    const asset = assets.find((item) => String(item.id) === assetId && item.state === "uploaded");
    if (!asset) return NextResponse.json({ error: "File part was not found." }, { status: 404 });

    const response = await fetch(`https://api.github.com${context.basePath}/releases/assets/${assetId}`, {
      headers: {
        Accept: "application/octet-stream",
        Authorization: `Bearer ${context.token}`,
        "X-GitHub-Api-Version": "2022-11-28"
      },
      cache: "no-store"
    });
    if (!response.ok || !response.body) {
      return NextResponse.json({ error: "Could not download this file part from GitHub." }, { status: response.status || 502 });
    }

    return new Response(response.body, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": response.headers.get("content-length") ?? String(asset.size),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch {
    return NextResponse.json({ error: "Could not download this file part." }, { status: 502 });
  }
}
