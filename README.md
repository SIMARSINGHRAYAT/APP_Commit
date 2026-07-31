# CommitFlow for Vercel

This project is prepared for deployment on Vercel with a static front end and a serverless API.

## Prerequisites

- A Vercel account
- A GitHub repository connected to Vercel
- A GitHub OAuth app configured for the deployment domain

## Environment variables

Add the following in Vercel:

- GITHUB_CLIENT_ID = your GitHub OAuth app client ID
- GITHUB_CLIENT_SECRET = your GitHub OAuth app client secret
- APP_BASE_URL = your deployment URL, for example `https://your-app-name.vercel.app`
- GITHUB_LOGIN = your GitHub username
- GITHUB_EMAIL = your GitHub email address

Optional for remote pushes:
- GITHUB_TOKEN
- REPO_OWNER
- REPO_NAME

## GitHub OAuth setup

1. Create a GitHub OAuth app at https://github.com/settings/developers.
2. Set the authorization callback URL to `https://<your-vercel-domain>/api/auth/callback`.
3. Copy the client ID and client secret into the Vercel project environment variables.

## Deploy steps

1. Install dependencies with `npm install`.
2. Push the repository to GitHub.
3. Import the repository into Vercel.
4. Set the project root to this directory if Vercel prompts for it.
5. Add the environment variables above and deploy.

## Local checks

Run these commands before deployment:

- `npm install`
- `npm run check`

## Notes

The app uses a root-level static UI plus a serverless API route under the `api` folder. The old empty `vercel` folder has been removed.
