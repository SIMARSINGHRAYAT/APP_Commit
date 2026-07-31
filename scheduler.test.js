import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDateWindow, isDateSelected, resolveDailyCount } from './index.js';

test('buildDateWindow includes every day in the requested range', () => {
  const days = buildDateWindow('2026-07-01', '2026-07-03');
  assert.equal(days.length, 3);
  assert.deepEqual(days.map((d) => d.format('YYYY-MM-DD')), ['2026-07-01', '2026-07-02', '2026-07-03']);
});

test('selected day filters include only the allowed days', () => {
  const date = new Date('2026-07-02T00:00:00Z');
  const payload = { filterMode: 'selected', selectedDays: ['thursday'] };
  assert.equal(isDateSelected(date, payload), true);
});

test('daily count uses the configured value when no randomization is enabled', () => {
  const date = new Date('2026-07-03T00:00:00Z');
  const payload = { dailyCount: 5, randomize: false };
  assert.equal(resolveDailyCount(date, payload), 5);
});
