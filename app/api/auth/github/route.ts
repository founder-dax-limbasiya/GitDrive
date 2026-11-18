import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getGitDriveSession } from "@/lib/github-session";

export const runtime = "nodejs";

export async function GET(request: Request) {
  let session;
  try {
    session = await getGitDriveSession();
  } catch {
    return NextResponse.redirect(new URL("/?auth=not_configured", request.url));
  }

  const clientId = session.appClientId ?? process.env.GITHUB_APP_CLIENT_ID;
  const redirectUri = process.env.GITHUB_APP_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return NextResponse.redirect(new URL("/?auth=not_configured", request.url));
  }

  const state = randomBytes(32).toString("hex");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("scope", "offline_access");
  authorizeUrl.searchParams.set("allow_signup", "false");

  const response = NextResponse.redirect(authorizeUrl);
  const secure = process.env.NODE_ENV === "production";
  response.cookies.set("gitdrive_oauth_state", state, {
    httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 600
  });
  response.cookies.set("gitdrive_oauth_verifier", verifier, {
    httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 600
  });
  return response;
}
