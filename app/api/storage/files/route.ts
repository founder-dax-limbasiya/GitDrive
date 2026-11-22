import { NextResponse } from "next/server";
import { getStorageContext, isGitDriveRelease, listReleaseAssets, parseReleaseBody } from "@/lib/github-storage";

export const runtime = "nodejs";
export const maxDuration = 60;

type ReleaseRecord = {
  id: number;
  tag_name: string;
  body: string | null;
  draft: boolean;
  assets_url: string;
};

export async function GET() {
  try {
    const context = await getStorageContext();
    if (!context) return NextResponse.json({ error: "Connect GitHub and select a private storage repository first." }, { status: 401 });

    const allReleases: ReleaseRecord[] = [];
    for (let page = 1; page <= 20; page += 1) {
      const response = await fetch(`https://api.github.com${context.basePath}/releases?per_page=100&page=${page}`, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${context.token}`,
          "X-GitHub-Api-Version": "2022-11-28"
        },
        cache: "no-store"
      });
      if (!response.ok) return NextResponse.json({ error: "Could not read GitHub Releases. Check the app's Contents permission." }, { status: response.status });
      const items = await response.json() as ReleaseRecord[];
      allReleases.push(...items);
      if (items.length < 100) break;
    }

    const valid = allReleases.filter((release) => {
      if (release.draft || !isGitDriveRelease(release)) return false;
      const values = parseReleaseBody(release.body);
      return values.status === "complete" && values.volume === "0" && values.purpose !== "diagnostic" && Boolean(values.salt) && /^[0-9a-f-]{36}$/i.test(values.file_id ?? "");
    });

    const files = [];
    for (const first of valid) {
      const meta = parseReleaseBody(first.body);
      const fileId = meta.file_id;
      const volumes = allReleases
        .filter((release) => {
          if (release.draft || !isGitDriveRelease(release)) return false;
          const values = parseReleaseBody(release.body);
          return values.file_id === fileId && Number.isSafeInteger(Number(values.volume));
        })
        .sort((a, b) => Number(parseReleaseBody(a.body).volume) - Number(parseReleaseBody(b.body).volume));

      const volumeData = [];
      for (const volume of volumes) {
        const volumeAssets = await listReleaseAssets(context, volume.id);
        volumeData.push({
          index: Number(parseReleaseBody(volume.body).volume),
          releaseId: volume.id,
          assets: volumeAssets
            .filter((asset) => asset.state === "uploaded")
            .map((asset) => ({ id: asset.id, name: asset.name, size: asset.size }))
        });
      }

      const firstVolume = volumeData.find((volume) => volume.index === 0);
      const manifest = firstVolume?.assets.find((asset) => asset.name === "manifest.gd");
      if (!manifest) continue;

      files.push({
        fileId,
        salt: meta.salt,
        manifestAssetId: manifest.id,
        manifestReleaseId: first.id,
        volumes: volumeData
      });
    }

    return NextResponse.json({ files }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not list GitDrive files.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
