# GitDrive

A mobile-first personal cloud-drive interface with GitHub as the planned storage provider.

## Current status

The first deployed version includes:
- Responsive drive dashboard
- Local file-picker and drag/drop preview (not remote upload)
- Guided GitHub App registration using GitHub's App Manifest flow
- GitHub authorization-code flow with PKCE and state validation
- Encrypted, HttpOnly browser session; GitHub app credentials and user tokens are not exposed to browser JavaScript
- Access-token refresh support
- Private, writable repository discovery and storage-repository validation

**Remote file upload/download is not implemented yet.** Sample rows and locally selected files are illustrative only.

## Stack

- Next.js App Router
- React + TypeScript
- Tailwind CSS
- iron-session
- GitHub REST API

## GitHub setup

Open the deployed app and choose **Set up GitHub**. GitDrive prepares the GitHub App registration form with the minimum permissions it currently needs:
- Contents: read/write
- Metadata: read-only
- No webhooks or event subscriptions

The guided flow creates a private GitHub App owned by the person setting up the personal beta. GitHub generates its Client ID and Client Secret, which are stored in the encrypted, HttpOnly session cookie for this browser. That means this is currently a personal single-owner setup; it is not yet the shared multi-user SaaS credential architecture.

After GitHub creates the app:
1. Install it on your GitHub account.
2. Select only a separate private repository for storage.
3. GitHub returns you to GitDrive to authorize the app.
4. Choose the private repository in the GitDrive dashboard.

Create a dedicated private repository such as `GitDrive-Storage` before installing the app. Do not use the public GitDrive source repository to store personal files, and do not select unrelated private repositories.

## Environment

Set these in Vercel:
- `GITHUB_APP_REDIRECT_URI=https://gitdrive-omega.vercel.app/api/auth/github/callback`
- `GITDRIVE_SESSION_PASSWORD` — random secret with at least 32 characters

The production Vercel project already has these two variables configured. For local development, copy `.env.example` to `.env.local` and use your own random session password.

## Product principles

- GitHub is the only planned remote file-storage provider for this version.
- Never promise unlimited storage or bypass GitHub quotas/terms.
- Store user data as encrypted release assets, not in the public source repository.
- Encrypt on the client before remote upload; keep recovery material under the user's control.
- Never delete the user's original file automatically.
- Do not connect or modify the separate CloudVault project.

## Next milestones

1. Finish a real GitHub App install and authorization test.
2. Implement client-side encryption, chunking, retry and file manifests.
3. Upload encrypted chunks as private GitHub Release assets.
4. Implement verified download and reassembly.
5. Add safe sharing and supported-format streaming after access-control and quota behaviour are tested.
6. Move App credentials into a secure server-side multi-user store before opening the product to public users.

## Important

A GitHub-backed storage product must respect GitHub's published terms, file-size limits, rate limits and acceptable-use rules. Chunking does not remove aggregate storage or bandwidth limits.
