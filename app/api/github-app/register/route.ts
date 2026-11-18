import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function GET(request: Request) {
  if (!process.env.GITDRIVE_SESSION_PASSWORD) {
    return NextResponse.redirect(new URL("/?auth=not_configured", request.url));
  }

  const origin = new URL(request.url).origin;
  const state = randomBytes(32).toString("hex");
  const manifest = {
    name: "GitDrive",
    url: origin,
    description: "Connect your GitHub account to your private GitDrive storage.",
    redirect_url: `${origin}/api/github-app/callback`,
    callback_urls: [`${origin}/api/auth/github/callback`],
    setup_url: `${origin}/api/github-app/installed`,
    public: false,
    default_permissions: {
      contents: "write",
      metadata: "read"
    },
    default_events: [],
    request_oauth_on_install: false
  };

  const manifestValue = escapeHtml(JSON.stringify(manifest));
  const safeState = encodeURIComponent(state);
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Set up GitDrive</title>
  <style>
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#f7f8fa;color:#101828;font-family:Arial,Helvetica,sans-serif}
    main{width:min(100%,480px);padding:32px;border:1px solid #e7eaf0;border-radius:24px;background:#fff;box-shadow:0 12px 36px rgba(16,24,40,.06)}
    h1{margin:0 0 10px;font-size:26px;letter-spacing:-.6px}p{font-size:14px;line-height:1.7;color:#667085}
    button{width:100%;height:48px;margin-top:16px;border:0;border-radius:12px;background:#101828;color:#fff;font-weight:700;font-size:14px}
    .small{font-size:12px;color:#667085;margin-top:18px}
  </style>
</head>
<body>
  <main>
    <h1>Set up GitDrive</h1>
    <p>First create a separate private repository for your files. Give it the name <strong>GitDrive-Storage</strong>, keep it private, and leave it empty.</p>
    <p><a href="https://github.com/new?name=GitDrive-Storage&visibility=private" target="_blank" rel="noopener noreferrer">Create the private storage repository</a></p>
    <p>Then continue. GitDrive will ask GitHub to create its app with only two permissions: read repository metadata and read/write repository contents.</p>
    <form method="post" action="https://github.com/settings/apps/new?state=${safeState}">
      <textarea name="manifest" hidden>${manifestValue}</textarea>
      <button type="submit">Continue to GitHub</button>
    </form>
    <p class="small">GitDrive will only access repositories you choose during installation. We recommend selecting only a separate private repository for storage.</p>
  </main>
</body>
</html>`;

  const response = new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer"
    }
  });
  response.cookies.set("gitdrive_manifest_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600
  });
  return response;
}
