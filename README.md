# GitDrive

A mobile-first personal cloud-drive interface with GitHub as the planned storage provider.

## Current status

The first deployed version includes:
- Responsive drive dashboard
- Local file-picker and drag/drop preview (not remote upload)
- GitHub App authorization-code flow with PKCE and state validation
- Encrypted, HttpOnly session cookie; GitHub access tokens are not returned to browser JavaScript
- Access-token refresh support
- Private, writable repository discovery and storage-repository validation

**Remote file upload/download is not implemented yet.** Sample rows and locally selected files are illustrative only.

## Stack

- Next.js App Router
- React + TypeScript
- Tailwind CSS
- iron-session
- GitHub REST API

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

## GitHub App setup

Create a GitHub App at https://github.com/settings/apps/new.

Configure:
- Homepage URL: `https://gitdrive-omega.vercel.app`
- User authorization callback URL: `https://gitdrive-omega.vercel.app/api/auth/github/callback`
- Repository permission: **Contents — Read and write**
- Metadata permission: **Read-only** (required/default)
- Webhooks: not needed for the current milestone

For private storage, create a separate private repository (for example, `GitDrive-Storage`) and install the GitHub App with access only to that repository. Do not use the public GitDrive source repository to store personal files.

Add these values to Vercel project environment variables for Production, Preview and Development:
- `GITHUB_APP_CLIENT_ID`
- `GITHUB_APP_CLIENT_SECRET`
- `GITHUB_APP_REDIRECT_URI` (already configured in this Vercel project)
- `GITDRIVE_SESSION_PASSWORD` (already configured as a secret in this Vercel project)

Never paste the Client Secret or session password into source code or commit them to GitHub.

## Product principles

- GitHub is the only planned remote file-storage provider for this version.
- Never promise unlimited storage or bypass GitHub quotas/terms.
- Store user data as encrypted release assets, not in the public source repository.
- Encrypt on the client before remote upload; keep recovery material under the user's control.
- Never delete the user's original file automatically.
- Do not connect or modify the separate CloudVault project.

## Next milestones

1. Finish GitHub App setup and validate a real connection.
2. Implement client-side encryption, chunking, retry and file manifests.
3. Upload encrypted chunks as private GitHub Release assets.
4. Implement verified download and reassembly.
5. Add safe sharing and supported-format streaming after access-control and quota behaviour are tested.

## Important

A GitHub-backed storage product must respect GitHub's published terms, file-size limits, rate limits and acceptable-use rules. Chunking does not remove aggregate storage or bandwidth limits.
