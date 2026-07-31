import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import moment from 'moment';

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();
const defaultResponseHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    ...defaultResponseHeaders,
  });
  res.end(JSON.stringify(payload));
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=');
        return index === -1 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function decodeSessionCookie(req) {
  const cookieValue = parseCookies(req).gh_session;
  if (!cookieValue) return null;

  try {
    return JSON.parse(Buffer.from(cookieValue, 'base64url').toString('utf8'));
  } catch (error) {
    return null;
  }
}

function setSessionCookie(res, user) {
  const session = Buffer.from(JSON.stringify(user)).toString('base64url');
  const secureFlag = process.env.APP_BASE_URL?.startsWith('https://') ? '; Secure' : '';
  res.setHeader('Set-Cookie', `gh_session=${session}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${secureFlag}`);
}

function resolveGitHubIdentity(user = {}, env = process.env) {
  const login = user.login || env.GITHUB_LOGIN || 'github-user';
  const email = user.email || env.GITHUB_EMAIL || `${login}@users.noreply.github.com`;
  const accessToken = user.accessToken || env.GITHUB_TOKEN || null;
  const repoOwner = user.repoOwner || env.REPO_OWNER || login;
  const repoName = user.repoName || env.REPO_NAME || 'APP_Commit';

  return { login, email, accessToken, repoOwner, repoName };
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      'User-Agent': 'CommitFlow',
      ...(init.headers || {}),
    },
  });

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();

  if (!response.ok) {
    const message = typeof payload === 'string' ? payload : payload.message || 'GitHub request failed.';
    throw new Error(message);
  }

  return payload;
}

async function getCurrentUser(req) {
  const sessionUser = decodeSessionCookie(req);
  if (sessionUser) {
    return resolveGitHubIdentity(sessionUser, process.env);
  }

  return null;
}

async function getGitHubUserFromToken(accessToken) {
  const user = await fetchJson('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  let email = user.email || null;
  if (!email) {
    const emailList = await fetchJson('https://api.github.com/user/emails', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const primary = Array.isArray(emailList)
      ? emailList.find((entry) => entry.primary && entry.verified) || emailList.find((entry) => entry.verified)
      : null;
    email = primary ? primary.email : `${user.login}@users.noreply.github.com`;
  }

  return { login: user.login, email, accessToken };
}

async function exchangeCodeForToken(code) {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('GitHub OAuth is not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.');
  }

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
  });

  const tokenResponse = await fetchJson(`https://github.com/login/oauth/access_token?${params.toString()}`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
  });

  if (!tokenResponse.access_token) {
    throw new Error('GitHub OAuth token exchange did not return an access token.');
  }

  return tokenResponse.access_token;
}

function getDayName(date) {
  const value = moment.isMoment(date) ? date : moment(date);
  return value.format('dddd').toLowerCase();
}

function isDateSelected(date, payload) {
  const safeDate = moment.isMoment(date) ? date : moment(date);
  const mode = payload.filterMode || 'all';
  const selectedDays = Array.isArray(payload.selectedDays) ? payload.selectedDays.map((d) => d.toLowerCase()) : [];
  const dayName = getDayName(safeDate);
  const dayNumber = safeDate.date();

  if (mode === 'odd') return dayNumber % 2 === 1;
  if (mode === 'even') return dayNumber % 2 === 0;
  if (mode === 'weekends') return ['saturday', 'sunday'].includes(dayName);
  if (mode === 'weekdays') return !['saturday', 'sunday'].includes(dayName);
  if (mode === 'selected') return selectedDays.includes(dayName);
  return true;
}

function resolveDailyCount(date, payload) {
  const safeDate = moment.isMoment(date) ? date : moment(date);
  const weekdayMap = payload.weekdayCounts || {};
  const weekdayKey = getDayName(safeDate);
  const baseCount = Number(payload.dailyCount || 1);

  if (weekdayMap[weekdayKey] !== undefined && Number(weekdayMap[weekdayKey]) >= 0) {
    return Number(weekdayMap[weekdayKey]);
  }

  if (payload.randomize) {
    const max = Number(payload.maxPerDay || baseCount || 1);
    const min = Math.min(1, max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  return baseCount;
}

function buildDateWindow(startDate, endDate) {
  const start = moment(startDate, 'YYYY-MM-DD');
  const end = moment(endDate, 'YYYY-MM-DD');

  if (!start.isValid() || !end.isValid()) {
    throw new Error('Please choose a valid start date and end date.');
  }

  if (end.isBefore(start)) {
    throw new Error('The end date must be after the start date.');
  }

  const dates = [];
  let current = start.clone();
  while (current.isSameOrBefore(end)) {
    dates.push(current.clone());
    current.add(1, 'day');
  }
  return dates;
}

function spreadTimesForDay(date, count) {
  const start = moment(date).hour(9).minute(0).second(0).millisecond(0);
  const end = moment(date).hour(20).minute(0).second(0).millisecond(0);

  if (count <= 1) return [start.clone()];

  const diffMinutes = end.diff(start, 'minutes');
  const step = diffMinutes / (count - 1);
  const times = [];

  for (let i = 0; i < count; i += 1) {
    times.push(start.clone().add(Math.round(step * i), 'minutes'));
  }

  return times;
}

async function getFileContent(owner, repo, branch, path, token) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`;
  try {
    const file = await fetchJson(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return { sha: file.sha, content: Buffer.from(file.content, 'base64').toString('utf8') };
  } catch (error) {
    if (String(error.message).includes('404')) {
      return null;
    }
    throw error;
  }
}

async function updateFileContent({ owner, repo, branch, path, content, message, author, committer, token, sha }) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
  const payload = {
    message,
    content: Buffer.from(content).toString('base64'),
    branch,
    author,
    committer,
  };
  if (sha) payload.sha = sha;

  return fetchJson(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
}

async function createCommitEntry({ user, repoOwner, repoName, branch, commitTime, message, token, commitLogPath, commitCount }) {
  const path = commitLogPath;
  const file = await getFileContent(repoOwner, repoName, branch, path, token);
  let entries = [];
  if (file && file.content) {
    try {
      entries = JSON.parse(file.content);
    } catch (error) {
      entries = [];
    }
  }

  entries.push({
    commitNumber: commitCount,
    date: commitTime.format('YYYY-MM-DD'),
    time: commitTime.format('HH:mm'),
    message,
    author: { name: user.login, email: user.email },
    branch,
  });

  const content = JSON.stringify(entries, null, 2) + '\n';
  const result = await updateFileContent({
    owner: repoOwner,
    repo: repoName,
    branch,
    path,
    content,
    message,
    author: {
      name: user.login,
      email: user.email,
      date: commitTime.toISOString(),
    },
    committer: {
      name: user.login,
      email: user.email,
      date: commitTime.toISOString(),
    },
    token,
    sha: file ? file.sha : undefined,
  });

  return result;
}

async function generateCommits(payload, req) {
  const user = await getCurrentUser(req);
  if (!user) {
    throw new Error('GitHub sign-in is required before generating commits.');
  }

  const startDate = payload.startDate;
  const endDate = payload.endDate;
  const dailyCount = Number(payload.dailyCount || 1);
  const pushToRemote = Boolean(payload.pushToRemote);
  const branchName = (payload.branch || 'main').toString().trim() || 'main';
  const repoOwner = payload.repoOwner?.trim() || user.login;
  const repoName = payload.repoName?.trim() || 'APP_Commit';
  const token = user.accessToken;

  if (!token) {
    throw new Error('GitHub OAuth token is missing. Sign in again and grant repository access.');
  }

  if (!startDate || !endDate) {
    throw new Error('Please choose a valid start date and end date.');
  }

  if (!Number.isInteger(dailyCount) || dailyCount < 1) {
    throw new Error('Daily commit count must be a whole number greater than zero.');
  }

  const selectedDates = buildDateWindow(startDate, endDate).filter((date) => isDateSelected(date, payload));
  if (!selectedDates.length) {
    throw new Error('No days match your selected filter.');
  }

  const created = [];
  let totalCount = 0;
  const commitLogPath = 'commit-log.json';

  for (const selectedDate of selectedDates) {
    const countForDay = resolveDailyCount(selectedDate, payload);
    const times = spreadTimesForDay(selectedDate, countForDay);

    for (const commitTime of times) {
      const message = `Auto commit ${totalCount + 1} — ${commitTime.format('YYYY-MM-DD HH:mm')}`;
      const commitNumber = totalCount + 1;

      if (pushToRemote) {
        await createCommitEntry({
          user,
          repoOwner,
          repoName,
          branch: branchName,
          commitTime,
          message,
          token,
          commitLogPath,
          commitCount: commitNumber,
        });
      }

      created.push({
        number: commitNumber,
        date: commitTime.format('YYYY-MM-DD'),
        time: commitTime.format('HH:mm'),
        message,
      });
      totalCount += 1;
    }
  }

  return {
    success: true,
    branch: branchName,
    repoOwner,
    repoName,
    startDate,
    endDate,
    selectedDays: selectedDates.length,
    commitsCreated: totalCount,
    pushToRemote,
    pushResult: {
      enabled: pushToRemote,
      status: pushToRemote ? 'success' : 'skipped',
      message: pushToRemote ? 'Commits created on GitHub.' : 'Remote commit generation was skipped.',
    },
    created,
  };
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error('Invalid JSON body.'));
      }
    });
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    sendJson(res, 200, { success: true });
    return;
  }

  const url = new URL(req.url, 'https://example.com');
  const normalizedPath = url.pathname.replace(/^\/api/, '');
  console.log('API request', req.method, 'req.url=', req.url, 'pathname=', url.pathname, 'normalized=', normalizedPath);

  if (req.method === 'GET' && normalizedPath === '/auth/status') {
    try {
      const user = await getCurrentUser(req);
      if (!user) {
        throw new Error('Not authenticated.');
      }
      sendJson(res, 200, { success: true, user });
    } catch (error) {
      sendJson(res, 401, { success: false, message: error.message });
    }
    return;
  }

  if (req.method === 'GET' && normalizedPath === '/auth/configured') {
    const configured = Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
    const missing = [];
    if (!process.env.GITHUB_CLIENT_ID) missing.push('GITHUB_CLIENT_ID');
    if (!process.env.GITHUB_CLIENT_SECRET) missing.push('GITHUB_CLIENT_SECRET');
    sendJson(res, 200, { success: true, configured, missing });
    return;
  }

  if (req.method === 'GET' && normalizedPath === '/auth/login') {
    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>GitHub OAuth Not Configured</title><style>body{margin:0;font-family:Inter,sans-serif;background:#081222;color:#e2e8f0;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center;padding:24px;}div{max-width:520px;}a{color:#6ee7f9;text-decoration:none;font-weight:700;}</style></head><body><div><h1>GitHub OAuth is not configured</h1><p>This deployment is missing required GitHub OAuth environment variables. Set <code>GITHUB_CLIENT_ID</code> and <code>GITHUB_CLIENT_SECRET</code> in Vercel to enable login.</p><p><a href="/">Return to the app</a></p></div></body></html>`);
      return;
    }

    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers.host || 'localhost:3000';
    const baseUrl = process.env.APP_BASE_URL || `${protocol}://${host}`;
    const redirectUri = encodeURIComponent(`${baseUrl}/api/auth/callback`);
    const loginUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&scope=repo%20read:user%20user:email`;
    res.writeHead(302, { Location: loginUrl });
    res.end();
    return;
  }

  if (req.method === 'GET' && normalizedPath === '/auth/callback') {
    try {
      const code = url.searchParams.get('code');
      if (!code) {
        throw new Error('GitHub authorization code was not received.');
      }
      const accessToken = await exchangeCodeForToken(code);
      const user = await getGitHubUserFromToken(accessToken);
      setSessionCookie(res, user);
      res.writeHead(302, { Location: '/' });
      res.end();
    } catch (error) {
      sendJson(res, 400, { success: false, message: error.message || 'GitHub login failed.' });
    }
    return;
  }

  if (req.method === 'GET' && normalizedPath === '/auth/logout') {
    res.setHeader('Set-Cookie', 'gh_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    sendJson(res, 200, { success: true, message: 'Signed out.' });
    return;
  }

  if (req.method === 'POST' && normalizedPath === '/generate') {
    try {
      const payload = await parseBody(req);
      const result = await generateCommits(payload, req);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 400, { success: false, message: error.message || 'Failed to generate the commit schedule.' });
    }
    return;
  }

  sendJson(res, 404, { success: false, message: 'Route not found.' });
}
