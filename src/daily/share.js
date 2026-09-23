/**
 * share.js — 결과 공유 텍스트 + 월별 캘린더 공유.
 * (DailyTrilateral/src/daily/share.js 이식 — 캘린더 부분은 그대로, 결과 부분은 추측별 이모지로)
 */
import { resultEmoji, MAX_GUESSES } from '../game/game.js';

/** 추측마다 이모지 하나(🟩 함선 완성 · 🟨 새 글자 · 🟧 새 명중 · ⬜ 소득 없음), 10개씩 줄바꿈 */
export function buildGuessEmojiGrid(results) {
  const cells = results.map(resultEmoji);
  const rows = [];
  for (let i = 0; i < cells.length; i += 10) rows.push(cells.slice(i, i + 10).join(''));
  return rows.join('\n');
}

/** 결과 요약 한 줄 — '🚢 4/4 · 추측 14/20' */
export function buildSummaryLine(state, shipCount) {
  const found = state.completed.filter(Boolean).length;
  return `🚢 ${found}/${shipCount} · 추측 ${state.results.length}/${MAX_GUESSES}`;
}

/** 공유용 전체 텍스트. title 예: '데일리 워십 · 2026-09-24' */
export function buildShareText({ title, state, shipCount, url }) {
  const parts = [title, buildSummaryLine(state, shipCount), buildGuessEmojiGrid(state.results), ''];
  if (url) parts.push(url);
  return parts.join('\n');
}

const CAL_EMOJI = { solved: '🟩', fail: '🟥', miss: '⬜', pad: '⬛' };

/**
 * 통계 달력을 이모지 텍스트로. results = { 'YYYY-MM-DD': { status, ... } }
 * 성공 🟩 · 실패 🟥 · 안 함 ⬜ · 달 밖(주 정렬용) ⬛
 */
export function buildCalendarShareText({ results, year, month, url }) {
  const firstDow    = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(CAL_EMOJI.pad);
  let wins = 0, fails = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const r = results[ds];
    if (r && r.status === 'solved') { cells.push(CAL_EMOJI.solved); wins++; }
    else if (r) { cells.push(CAL_EMOJI.fail); fails++; }
    else cells.push(CAL_EMOJI.miss);
  }
  while (cells.length % 7 !== 0) cells.push(CAL_EMOJI.pad);
  const rows = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7).join(''));

  const head = `데일리 워십 · ${year}-${String(month).padStart(2, '0')}`;
  const parts = [head, `✅ ${wins}  ❌ ${fails}`, '', ...rows, ''];
  if (url) parts.push(url);
  return parts.join('\n');
}
