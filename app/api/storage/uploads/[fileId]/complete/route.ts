import { NextResponse } from "next/server";
import {
  buildReleaseBody,
  getRelease,
  getStorageContext,
  GITDRIVE_ASSETS_PER_VOLUME,
  listReleaseAssets,
  parseReleaseBody
} from "@/lib/github-storage";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  request: Request,
  contextParams: { params: Promise<{ fileId: string }> }
) {
  try {
    const context = await getStorageContext();
    if (!context) return NextResponse.json({ error: "Connect GitHub and select a storage repository first." }, { status: 401 });

    const { fileId } = await contextParams.params;
    if (!/^[0-9a-f-]{36}$/i.test(fileId)) return NextResponse.json({ error: "Invalid file identifier." }, { status: 400 });

    const body = await request.json() as { releaseIds?: Array<number | string> };
    const releaseIds = body.releaseIds;
    if (!Array.isArray(releaseIds) || releaseIds.length < 1 || releaseIds.length > 1000) {
      return NextResponse.json({ error: "Invalid release list." }, { status: 400 });
    }

    const releases: Array<{ id: number; volume: number; body: string | null }> = [];
    let partCount = 0;
    for (let volume = 0; volume < releaseIds.length; volume += 1) {
      const releaseId = String(releaseIds[volume]);
      if (!/^\d+$/.test(releaseId)) return NextResponse.json({ error: "Invalid release identifier." }, { status: 400 });

      const response = await getRelease(context, releaseId);
      if (!response.ok) return NextResponse.json({ error: "An upload volume could not be found." }, { status: 404 });
      const release = await response.json() as { id: number; tag_name: string; draft: boolean; body: string | null };
      const metadata = parseReleaseBody(release.body);

      if (
        !release.draft ||
        release.tag_name !== `gitdrive-file-${fileId}-v${volume}` ||
        metadata.gitdrive !== "1" ||
        metadata.file_id !== fileId ||
        Number(metadata.volume) !== volume
      ) {
        return NextResponse.json({ error: "A release volume does not belong to this upload." }, { status: 409 });
      }

      const count = Number(metadata.part_count);
      if (!Number.isSafeInteger(count) || count < 1) return NextResponse.json({ error: "Upload manifest is invalid." }, { status: 409 });
      if (volume === 0) partCount = count;
      else if (count !== partCount) return NextResponse.json({ error: "Upload volume metadata does not match." }, { status: 409 });

      const expectedChunkCount = Math.min(GITDRIVE_ASSETS_PER_VOLUME, partCount - volume * GITDRIVE_ASSETS_PER_VOLUME);
      const assets = await listReleaseAssets(context, release.id);
      const chunkAssets = assets.filter((asset) => /^chunk-\d{6}\.gd$/.test(asset.name) && asset.state === "uploaded");
      const manifestAssets = assets.filter((asset) => asset.name === "manifest.gd" && asset.state === "uploaded");
      if (chunkAssets.length !== expectedChunkCount || (volume === 0 ? manifestAssets.length !== 1 : manifestAssets.length !== 0)) {
        return NextResponse.json({ error: `Upload volume ${volume + 1} is incomplete. Please retry missing parts.` }, { status: 409 });
      }

      for (let i = 0; i < expectedChunkCount; i += 1) {
        const expectedName = `chunk-${String(i).padStart(6, "0")}.gd`;
        if (!chunkAssets.some((asset) => asset.name === expectedName)) {
          return NextResponse.json({ error: `Missing part ${volume * GITDRIVE_ASSETS_PER_VOLUME + i + 1}.` }, { status: 409 });
        }
      }

      releases.push({ id: release.id, volume, body: release.body });
    }

    const expectedVolumes = Math.ceil(partCount / GITDRIVE_ASSETS_PER_VOLUME);
    if (releaseIds.length !== expectedVolumes) {
      return NextResponse.json({ error: "Some upload volumes are missing." }, { status: 409 });
    }

    // Publish data volumes first. The index volume is published last and marks
    // the file complete, so the library never lists a partially uploaded file.
    for (const release of releases.slice(1)) {
      const response = await fetch(`https://api.github.com${context.basePath}/releases/${release.id}`, {
        method: "PATCH",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${context.token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ draft: false }),
        cache: "no-store"
      });
      if (!response.ok) return NextResponse.json({ error: "Could not publish all file parts. Retry completion." }, { status: 502 });
    }

    const first = releases[0];
    const firstMetadata = parseReleaseBody(first.body);
    const published = await fetch(`https://api.github.com${context.basePath}/releases/${first.id}`, {
      method: "PATCH",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${context.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        draft: false,
        body: buildReleaseBody({
          fileId,
          volume: 0,
          partCount,
          salt: firstMetadata.salt,
          status: "complete"
        })
      }),
      cache: "no-store"
    });

    if (!published.ok) return NextResponse.json({ error: "Could not publish the completed file." }, { status: 502 });
    return NextResponse.json({ ok: true, fileId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not complete upload.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
