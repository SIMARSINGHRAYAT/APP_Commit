# CommitFlow for Vercel

This folder is prepared for deployment on Vercel.

## Prerequisites

- A Vercel account
- A GitHub repository connected to Vercel
- A GitHub account with credentials assigned in Vercel environment variables

## Environment variables

Add the following in Vercel:

- GITHUB_LOGIN = your GitHub username
- GITHUB_EMAIL = your GitHub email address
- Optional for remote pushes:
  - GITHUB_TOKEN
  - REPO_OWNER
  - REPO_NAME

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
