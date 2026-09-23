/**
 * storage.js — 데일리 진행 상태 + 통계 localStorage 저장/복원.
 * (DailyTrilateral/src/daily/storage.js 이식 — 모드 구분 제거, 분포는 추측 수 구간으로)
 * 모든 접근은 try/catch로 감싼다(프라이빗 모드/차단 브라우저에서도 게임은 되게).
 */
import { shiftDateStr } from './dateUtil.js';

const PROGRESS_KEY = (date) => `wordship:progress:${date}`;
const STATS_KEY = 'wordship:stats';

function readJSON(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 저장 실패해도 진행엔 지장 없음 */ }
}

// ── 진행 상태 ──

/**
 * @typedef {object} Progress
 * @property {string} date
 * @property {string} onsets     그 날 퍼즐의 초성 64자 — 퍼즐이 바뀌었는지 확인용
 * @property {{r,c,dir,len,word}[]} guesses  지금까지의 추측(이것만 있으면 상태를 다시 계산할 수 있다)
 * @property {'playing'|'solved'|'failed'} status
 */

/** @returns {Progress|null} */
export function loadProgress(date) {
  return readJSON(PROGRESS_KEY(date));
}

export function saveProgress(progress) {
  writeJSON(PROGRESS_KEY(progress.date), progress);
}

// ── 통계 ──

/** { results: { [date]: { status: 'solved'|'failed', attempt: number|null } } } */
export function loadStats() {
  const s = readJSON(STATS_KEY);
  return s && s.results ? s : { results: {} };
}

/** 그 날의 결과를 기록한다. 아카이브(지난 퍼즐)·자유 연습은 이 함수를 호출하지 않는다. */
export function recordResult(date, status, attempt = null) {
  const s = loadStats();
  s.results[date] = { status, attempt };
  writeJSON(STATS_KEY, s);
  return s;
}

// ── 집계 (통계창) ──

/** 사용한 추측 수 분포 — 30칸은 너무 길어서 5개씩 묶는다 */
export const DIST_BUCKETS = ['1~5번', '6~10번', '11~15번', '16~20번', '21~25번', '26~30번', '실패'];

export function bucketIndexFor(status, attempt) {
  if (status !== 'solved') return DIST_BUCKETS.length - 1;
  return Math.min(DIST_BUCKETS.length - 2, Math.max(0, Math.floor((attempt - 1) / 5)));
}

/**
 * @param {string} todayStr 현재 KST 날짜 — 연승 계산 기준
 * @returns {{ played, wins, winRate, curStreak, maxStreak, distribution: number[],
 *   results: Record<string,{status,attempt}> }}
 */
export function summarize(todayStr) {
  const { results } = loadStats();
  const dates = Object.keys(results).sort();
  const played = dates.length;
  let wins = 0;
  const distribution = new Array(DIST_BUCKETS.length).fill(0);
  for (const d of dates) {
    const r = results[d];
    if (r.status === 'solved') wins++;
    distribution[bucketIndexFor(r.status, r.attempt)]++;
  }

  // 최고 연승: 날짜가 하루씩 이어지면서 solved인 최장 구간
  let maxStreak = 0, run = 0, prev = null;
  for (const d of dates) {
    const consecutive = prev && shiftDateStr(prev, 1) === d;
    run = results[d].status === 'solved' ? (consecutive ? run + 1 : 1) : 0;
    if (run > maxStreak) maxStreak = run;
    prev = d;
  }

  // 현재 연승: 오늘(또는 어제)부터 뒤로 이어지는 solved
  let curStreak = 0;
  let cursor = results[todayStr] ? todayStr : shiftDateStr(todayStr, -1);
  while (results[cursor] && results[cursor].status === 'solved') {
    curStreak++;
    cursor = shiftDateStr(cursor, -1);
  }

  return {
    played,
    wins,
    winRate: played ? Math.round((wins / played) * 100) : 0,
    curStreak,
    maxStreak,
    distribution,
    results,
  };
}
