import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import {
  getRelease,
  getStorageContext,
  GITDRIVE_CHUNK_BYTES,
  parseReleaseBody,
  uploadStorageAsset
} from "@/lib/github-storage";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function PUT(
  request: Request,
  contextParams: { params: Promise<{ releaseId: string }> }
) {
  try {
    const context = await getStorageContext();
    if (!context) return NextResponse.json({ error: "Connect GitHub and select a storage repository first." }, { status: 401 });

    const { releaseId } = await contextParams.params;
    if (!/^\d+$/.test(releaseId)) return NextResponse.json({ error: "Invalid release identifier." }, { status: 400 });

    const name = new URL(request.url).searchParams.get("name") ?? "";
    const isManifest = name === "manifest.gd";
    const isChunk = /^chunk-\d{6}\.gd$/.test(name);
    if (!isManifest && !isChunk) return NextResponse.json({ error: "Invalid storage asset name." }, { status: 400 });

    const releaseResponse = await getRelease(context, releaseId);
    if (!releaseResponse.ok) return NextResponse.json({ error: "Storage release was not found." }, { status: 404 });
    const release = await releaseResponse.json() as {
      id: number;
      tag_name: string;
      draft: boolean;
      body: string | null;
      assets?: Array<{ id: number; name: string; size: number; state: string; digest?: string | null }>;
    };
    const metadata = parseReleaseBody(release.body);
    if (
      !release.draft ||
      !release.tag_name.startsWith("gitdrive-file-") ||
      metadata.gitdrive !== "1" ||
      metadata.status !== "pending"
    ) {
      return NextResponse.json({ error: "This release is not a pending GitDrive upload." }, { status: 409 });
    }

    const data = await request.arrayBuffer();
    const maxBytes = isManifest ? 1024 * 1024 : GITDRIVE_CHUNK_BYTES + 64;
    if (data.byteLength < 1 || data.byteLength > maxBytes) {
      return NextResponse.json({ error: "Upload part is larger than the allowed chunk size." }, { status: 413 });
    }

    const existing = release.assets?.find((asset) => asset.name === name && asset.state === "uploaded");
    if (existing) {
      const incomingDigest = "sha256:" + createHash("sha256").update(Buffer.from(data)).digest("hex");
      if (
        existing.size === data.byteLength &&
        (!existing.digest || existing.digest === incomingDigest)
      ) {
        return NextResponse.json({
          ok: true,
          reused: true,
          asset: { id: existing.id, name: existing.name, size: existing.size }
        });
      }
      return NextResponse.json({ error: "A different asset already exists with this part name." }, { status: 409 });
    }

    const asset = await uploadStorageAsset(context, releaseId, name, data);
    return NextResponse.json({ ok: true, asset: { id: asset.id, name: asset.name, size: asset.size } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not upload this file part.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
