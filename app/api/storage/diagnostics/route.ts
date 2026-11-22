import { randomBytes, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createStorageRelease, getRelease, getStorageContext, parseReleaseBody } from "@/lib/github-storage";
import { githubApiFetch } from "@/lib/github-session";

export const runtime = "nodejs";
export const maxDuration = 30;

function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export async function POST(request: Request) {
  if (!checkOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  try {
    const context = await getStorageContext();
    if (!context) {
      return NextResponse.json({ error: "Connect GitHub and select a private storage repository first." }, { status: 401 });
    }

    const repoResponse = await githubApiFetch(context.basePath, context.token);
    if (!repoResponse.ok) {
      return NextResponse.json({ error: "GitHub could not verify the selected storage repository." }, { status: repoResponse.status });
    }
    const repo = await repoResponse.json() as {
      private?: boolean;
      permissions?: { push?: boolean };
    };
    if (!repo.private || !repo.permissions?.push) {
      return NextResponse.json({ error: "The selected repository must be private and writable by GitDrive." }, { status: 403 });
    }

    const fileId = randomUUID();
    const salt = randomBytes(16).toString("base64");
    const release = await createStorageRelease(context, {
      fileId,
      volume: 0,
      partCount: 1,
      salt,
      purpose: "diagnostic"
    });

    return NextResponse.json(
      { fileId, salt, releaseId: release.id },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not prepare the storage self-test.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function DELETE(request: Request) {
  if (!checkOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  try {
    const context = await getStorageContext();
    if (!context) {
      return NextResponse.json({ error: "Connect GitHub and select a private storage repository first." }, { status: 401 });
    }

    const body = await request.json() as { fileId?: string; releaseId?: number };
    const fileId = body.fileId ?? "";
    const releaseId = body.releaseId;
    if (!/^[0-9a-f-]{36}$/i.test(fileId) || !Number.isSafeInteger(releaseId) || !releaseId || releaseId < 1) {
      return NextResponse.json({ error: "Invalid diagnostic cleanup request." }, { status: 400 });
    }

    const releaseResponse = await getRelease(context, releaseId);
    if (releaseResponse.status === 404) {
      return NextResponse.json({ ok: true, alreadyRemoved: true });
    }
    if (!releaseResponse.ok) {
      return NextResponse.json({ error: "Could not verify the temporary test release." }, { status: releaseResponse.status });
    }

    const release = await releaseResponse.json() as {
      id: number;
      tag_name: string;
      body: string | null;
    };
    const metadata = parseReleaseBody(release.body);
    const expectedTag = `gitdrive-file-${fileId}-v0`;
    if (
      release.id !== releaseId ||
      release.tag_name !== expectedTag ||
      metadata.gitdrive !== "1" ||
      metadata.file_id !== fileId ||
      metadata.volume !== "0" ||
      metadata.purpose !== "diagnostic"
    ) {
      return NextResponse.json({ error: "Cleanup can only remove the temporary GitDrive diagnostic release." }, { status: 409 });
    }

    const deleted = await githubApiFetch(`${context.basePath}/releases/${releaseId}`, context.token, { method: "DELETE" });
    if (!deleted.ok && deleted.status !== 404) {
      return NextResponse.json({ error: "The test passed, but GitHub could not remove the temporary release." }, { status: 502 });
    }

    const tag = encodeURIComponent(expectedTag);
    const tagDeleted = await githubApiFetch(`${context.basePath}/git/refs/tags/${tag}`, context.token, { method: "DELETE" });
    if (!tagDeleted.ok && tagDeleted.status !== 404) {
      return NextResponse.json({ error: "The temporary release was removed, but its Git tag could not be removed." }, { status: 502 });
    }

    return NextResponse.json({ ok: true, cleaned: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not clean up the temporary test release.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
