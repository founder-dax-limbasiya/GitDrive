# GitDrive

A mobile-first personal cloud drive that uses GitHub as its only remote storage provider.

## Current implementation

The repository now includes:
- Responsive drive dashboard
- Guided personal GitHub App registration
- GitHub OAuth authorization-code flow with PKCE and state validation
- Encrypted HttpOnly session cookies and access-token refresh
- Private writable repository discovery and repository selection
- Browser-side PBKDF2-SHA256 key derivation (310,000 iterations)
- AES-256-GCM encryption for each file chunk and manifest
- 4 MiB encrypted file chunks uploaded as private GitHub Release assets
- Multi-release volumes for files that need more than 900 chunks
- Encrypted manifests that contain the file name, size and chunk layout
- Download, decryption and automatic reassembly
- Authenticated asset proxy routes; GitHub tokens are not exposed to browser JavaScript

**The remote storage flow still needs its first live test after a GitHub App is created and installed.** The local sample rows are illustrative only.

## Stack

- Next.js App Router
- React + TypeScript
- Tailwind CSS
- iron-session
- GitHub REST API and private Releases

## GitHub setup

Open the deployed app and choose **Set up GitHub**. GitDrive prepares a personal GitHub App registration with the minimum required permissions:
- Contents: read/write
- Metadata: read-only
- No webhooks or event subscriptions

GitHub generates the app's Client ID and Client Secret. The guided flow stores them in the encrypted, HttpOnly session for this browser. This is a personal single-owner beta architecture, not the public multi-user SaaS architecture.

During installation, select **Only select repositories** and choose an existing private repository for GitDrive storage. No new repository is required. Do not select the public GitDrive source repository or unrelated repositories.

After installation, GitDrive redirects you to authorize your GitHub account. Back in the dashboard, choose the private repository from the available list and click **Use this repository**.

## Upload and encryption design

- Files are split into 4 MiB parts in the browser.
- Each part is encrypted with AES-256-GCM and a fresh 96-bit nonce.
- A per-file key is derived from the user's storage password and a random salt using PBKDF2-SHA256 (310,000 iterations).
- The encrypted manifest stores the filename, file size, MIME type, modification time and part layout. The manifest itself is encrypted.
- Encrypted parts and manifest are uploaded as binary Release assets in the selected private repository.
- A release volume contains at most 900 data assets plus its index allowance, leaving room below GitHub's documented 1,000-assets-per-release limit.
- Files spanning more than 900 parts are split across multiple GitHub Release volumes.
- Downloads decrypt each part in the browser and use AES-GCM authentication before reassembling the file.

The storage password is never sent to GitDrive's server. It cannot be reset: losing it means the encrypted data cannot be decrypted. Keep a safe copy outside GitDrive.

## Environment

The production Vercel project already has:
- `GITHUB_APP_REDIRECT_URI=https://gitdrive-omega.vercel.app/api/auth/github/callback`
- `GITDRIVE_SESSION_PASSWORD` stored as a Vercel secret

For local development, copy `.env.example` to `.env.local` and use your own random session password.

## Product principles

- GitHub is the only remote storage provider in this version.
- Do not promise unlimited storage or bypass GitHub quotas, rate limits or acceptable-use rules.
- Use a private repository for personal files.
- Never delete the user's original local file automatically.
- Do not connect or modify the separate CloudVault project.

## Known limitations / next work

1. Complete the first live GitHub App install and upload/download test.
2. Add resumable upload recovery after browser refresh or connection loss.
3. Add folder support, file deletion/trash, sharing and streaming only after access control is tested.
4. Improve large-file downloads to avoid holding the entire decrypted file in browser memory.
5. Move per-user app credentials into secure server-side storage before offering this as a public multi-user SaaS.

## GitHub Release constraints

GitHub documents up to 1,000 assets per release and requires each asset to be under 2 GiB. GitDrive uses smaller 4 MiB chunks and multiple volumes; chunking does not remove GitHub's policies or any applicable account, rate, bandwidth or acceptable-use restrictions. See [GitHub's release limits](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases) and [Release Assets API](https://docs.github.com/en/rest/releases/assets).
