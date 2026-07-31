# CommitFlow for Vercel

This folder is prepared for deployment on Vercel.

## Prerequisites

- A Vercel account
- A GitHub repository connected to Vercel
- A GitHub account with credentials assigned in Vercel environment variables

## Environment variables

Add the following in Vercel:

- GITHUB_CLIENT_ID = your GitHub OAuth app client ID
- GITHUB_CLIENT_SECRET = your GitHub OAuth app client secret
- APP_BASE_URL = your deployment URL, e.g. `https://commit-graph-web-app.vercel.app`
- GITHUB_LOGIN = your GitHub username
- GITHUB_EMAIL = your GitHub email address

Optional for remote pushes:
- GITHUB_TOKEN
- REPO_OWNER
- REPO_NAME

## GitHub OAuth setup

1. Create a GitHub OAuth app at https://github.com/settings/developers.
2. Set the "Authorization callback URL" to:
   `https://<your-vercel-domain>/api/auth/callback`
3. Copy the client ID and client secret into Vercel.

## Deploy steps

1. Push this folder or its contents to a GitHub repo.
2. Import the repo into Vercel.
3. Set the project root to this directory if needed.
4. Add the environment variables above.
5. Deploy the project.

## Usage

- Open the deployed app.
- Sign in using the GitHub auth endpoint.
- Pick the date range and daily count.
- Generate commits for every day in the selected range.
- Optionally push to the configured remote.

## Notes

This app is designed for a deployable front-end plus a serverless API route. It uses the Vercel API routing model and keeps the same scheduler behavior as the local app.
