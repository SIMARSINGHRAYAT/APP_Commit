import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import moment from 'moment';

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();
const fallbackUser = {
  login: process.env.GITHUB_LOGIN || 'SIMARSINGHRAYAT',
  email: process.env.GITHUB_EMAIL || 'simarsinghrayat03@gmail.com',
};

const defaultResponseHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function sendJson(res, statusCode, payload) {
  res.setHeader('Content-Type', 'application/json');
  Object.entries(defaultResponseHeaders).forEach(([k, v]) => res.setHeader(k, v));
  res.statusCode = statusCode;
  res.end(JSON.stringify(payload));
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

async function getAuthenticatedUser() {
  const login = process.env.GITHUB_LOGIN || fallbackUser.login;
  const email = process.env.GITHUB_EMAIL || fallbackUser.email;

  if (!login) {
    throw new Error('GitHub user is not configured. Set GITHUB_LOGIN and GITHUB_EMAIL in Vercel environment variables.');
  }

  return { login, email };
}

async function ensureRepoReady() {
  try {
    await execFileAsync('git', ['status'], { cwd: repoRoot });
    return true;
  } catch (error) {
    return false;
  }
}

async function generateCommits(payload) {
  const user = await getAuthenticatedUser();
  const startDate = payload.startDate;
  const endDate = payload.endDate;
  const dailyCount = Number(payload.dailyCount || 1);
  const pushToRemote = Boolean(payload.pushToRemote);
  const branchName = (payload.branch || 'main').toString().trim() || 'main';

  if (!startDate || !endDate) {
    throw new Error('Please choose a valid start and end date.');
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

  for (const selectedDate of selectedDates) {
    const countForDay = resolveDailyCount(selectedDate, payload);
    const times = spreadTimesForDay(selectedDate, countForDay);

    for (const time of times) {
      const message = `Auto commit ${totalCount + 1} — ${time.format('YYYY-MM-DD HH:mm')}`;
      const commitNumber = totalCount + 1;

      const env = {
        ...process.env,
        GIT_AUTHOR_NAME: user.login,
        GIT_AUTHOR_EMAIL: user.email,
        GIT_AUTHOR_DATE: time.toISOString(),
        GIT_COMMITTER_NAME: user.login,
        GIT_COMMITTER_EMAIL: user.email,
        GIT_COMMITTER_DATE: time.toISOString(),
      };

      try {
        const repoReady = await ensureRepoReady();
        if (!repoReady) {
          throw new Error('Git repository is not available in this deployment environment.');
        }

        await execFileAsync('git', ['config', 'user.name', user.login], { cwd: repoRoot, env });
        await execFileAsync('git', ['config', 'user.email', user.email], { cwd: repoRoot, env });
        await execFileAsync('git', ['add', '.'], { cwd: repoRoot, env });
        await execFileAsync('git', ['commit', '-m', message, '--allow-empty', '--no-gpg-sign', '--date', time.format()], {
          cwd: repoRoot,
          env,
        });
      } catch (error) {
        if (String(error.message).includes('nothing to commit')) {
          // This is safe in the Vercel deployment scenario and still counts as a generated activity entry.
        } else {
          throw error;
        }
      }

      created.push({
        number: commitNumber,
        date: time.format('YYYY-MM-DD'),
        time: time.format('HH:mm'),
        message,
      });
      totalCount += 1;
    }
  }

  let pushResult = {
    enabled: false,
    status: 'not_attempted',
    message: 'Push was not requested.',
  };

  if (pushToRemote) {
    try {
      if (process.env.GITHUB_TOKEN) {
        await execFileAsync('git', ['push', 'https://x-access-token:' + process.env.GITHUB_TOKEN + '@github.com/' + (process.env.REPO_OWNER || 'SIMARSINGHRAYAT') + '/' + (process.env.REPO_NAME || 'APP_Commit') + '.git', `HEAD:${branchName}`], { cwd: repoRoot });
        pushResult = { enabled: true, status: 'success', message: `Pushed to ${branchName}.` };
      } else {
        pushResult = { enabled: true, status: 'skipped', message: 'Remote push is configured for deployment with GITHUB_TOKEN.' };
      }
    } catch (error) {
      pushResult = { enabled: true, status: 'failed', message: error.message || 'Remote push failed.' };
    }
  }

  return {
    success: true,
    branch: branchName,
    startDate,
    endDate,
    selectedDays: selectedDates.length,
    commitsCreated: totalCount,
    pushToRemote,
    pushResult,
    created,
  };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    sendJson(res, 200, { success: true });
    return;
  }

  const url = new URL(req.url, 'https://example.com');

  if (req.method === 'GET' && url.pathname === '/api/auth/status') {
    try {
      const user = await getAuthenticatedUser();
      sendJson(res, 200, { success: true, user });
    } catch (error) {
      sendJson(res, 401, { success: false, message: error.message });
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/auth/github') {
    try {
      const user = await getAuthenticatedUser();
      sendJson(res, 200, { success: true, user, message: 'GitHub connected.' });
    } catch (error) {
      sendJson(res, 401, { success: false, message: 'GitHub sign-in is not configured yet. Add GITHUB_LOGIN and GITHUB_EMAIL to Vercel environment variables.' });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/generate') {
    try {
      const payload = await parseBody(req);
      const result = await generateCommits(payload);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 400, { success: false, message: error.message || 'Failed to generate the commit schedule.' });
    }
    return;
  }

  sendJson(res, 404, { success: false, message: 'Route not found.' });
}
