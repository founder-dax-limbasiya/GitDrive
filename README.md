# GitDrive

A mobile-first personal cloud-drive interface with GitHub as the planned storage provider.

## Current status

This repository currently contains the first frontend preview:
- Responsive dashboard layout
- File picker and drag/drop local preview
- Search across preview rows
- Explicit preview labels so sample/local files are not mistaken for cloud uploads

**GitHub storage is not connected yet.** Do not treat the sample rows or local preview as uploaded files.

## Stack

- Next.js App Router
- React + TypeScript
- Tailwind CSS
- lucide-react

## Run locally

```bash
npm install
npm run dev
```

## Product principles

- GitHub is the only planned remote file-storage provider for this version.
- Never promise unlimited storage or bypass GitHub quotas/terms.
- Use GitHub Releases for encrypted file chunks rather than committing user files into the source repository.
- Encrypt on the client before remote upload; keep recovery material under the user's control.
- Never delete the user's original file automatically.
- Do not connect or modify the separate CloudVault project.

## Next milestones

1. Configure a GitHub App OAuth flow and secure server-side token storage.
2. Add a private storage repository/release setup for each connected user.
3. Implement client-side chunk encryption, upload retry, manifests and integrity checks.
4. Implement verified download and reassembly.
5. Add sharing and supported-format streaming only after access-control and quota behaviour are tested.
6. Add deployment configuration and verify a production build.

## Important

A GitHub-backed storage product must respect GitHub's published terms, file-size limits, rate limits and acceptable-use rules. Chunking does not remove aggregate storage or bandwidth limits.
