/**
 * share.js — 결과 공유 텍스트 + 월별 캘린더 공유.
 * (DailyTrilateral/src/daily/share.js 이식 — 캘린더 부분은 그대로, 결과 부분은 함선별 칸 그림으로)
 */
import { MAX_GUESSES } from '../game/game.js';
import { boxCells } from '../game/board.js';

const PAD = '　'; // 전각 공백 — 이모지 한 칸 폭과 비슷해서 줄 맞춤에 쓴다

/**
 * 함선마다 칸 수만큼 네모를 그린 그림. 위치는 드러나지 않고 "단어를 얼마나 맞혔나"만 보인다.
 *   완성한 함선은 🟩 전부 / 아니면 칸별로 🟨 글자 공개 · 🟧 명중 · ⬜ 못 찾음
 * 긴 함선과 짧은 함선을 짝지어 한 줄에 둘씩 놓는다 (4칸+2칸 / 3칸+2칸 / 3칸+3칸).
 */
export function buildFleetGrid(puzzle, state) {
  const ships = puzzle.ships.map((ship, s) => ({ ship, s })).sort((a, b) => b.ship.len - a.ship.len || a.s - b.s);
  const draw = ({ ship, s }) => boxCells(ship).map((idx) => {
    if (state.completed[s]) return '🟩';
    if (state.revealed[idx]) return '🟨';
    if (state.hit[idx]) return '🟧';
    return '⬜';
  });
  const width = ships.length ? ships[0].ship.len : 0;
  const rows = [];
  for (let i = 0, j = ships.length - 1; i <= j; i++, j--) {
    const left = draw(ships[i]);
    if (i === j) { rows.push(left.join('')); break; }
    rows.push(left.join('') + PAD.repeat(width - left.length + 1) + draw(ships[j]).join(''));
  }
  return rows.join('\n');
}

/** 결과 요약 한 줄 — '🚢 6/6 · 추측 14/20' */
export function buildSummaryLine(state, shipCount, maxGuesses = MAX_GUESSES) {
  const found = state.completed.filter(Boolean).length;
  return `🚢 ${found}/${shipCount} · 추측 ${state.results.length}/${maxGuesses}`;
}

/** 공유용 전체 텍스트. title 예: '워드십 · 2026-09-24' */
export function buildShareText({ title, puzzle, state, url, maxGuesses }) {
  const parts = [title, buildSummaryLine(state, puzzle.ships.length, maxGuesses), buildFleetGrid(puzzle, state), ''];
  if (url) parts.push(url);
  return parts.join('\n');
}

const CAL_EMOJI = { solved: '🟩', fail: '🟥', miss: '⬜', pad: '⬛' };

/**
 * 통계 달력을 이모지 텍스트로. results = { 'YYYY-MM-DD': { status, ... } }
 * 성공 🟩 · 실패 🟥 · 안 함 ⬜ · 달 밖(주 정렬용) ⬛
 */
export function buildCalendarShareText({ results, year, month, url, label = '' }) {
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

  const head = `워드십${label ? ` · ${label}` : ''} · ${year}-${String(month).padStart(2, '0')}`;
  const parts = [head, `✅ ${wins}  ❌ ${fails}`, '', ...rows, ''];
  if (url) parts.push(url);
  return parts.join('\n');
}
