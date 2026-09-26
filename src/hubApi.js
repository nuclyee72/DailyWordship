/**
 * hubApi.js — ProjectDaily 허브(/ProjectDaily/)가 카드 안에서 이 게임의 통계를 보여 줄 때 쓰는 모듈.
 * 게임 통계창과 같은 계산(storage · share)을 그대로 쓴다. DOM은 건드리지 않는다.
 * (세 게임 모두 같은 모양: stats · calendarShareText · todayShareText)
 */
import { dateStrKST } from './daily/dateUtil.js';
import { summarize, loadProgress, distBuckets } from './daily/storage.js';
import { buildCalendarShareText, buildShareText } from './daily/share.js';
import { computeState, parsePuzzle } from './game/game.js';
import { modeOf } from './game/modes.js';

const SITE_URL = 'https://nuclyee72.github.io/DailyWordship/';

/** 숫자 4개 + 분포 막대 */
export function stats(mode) {
  const s = summarize(dateStrKST(), mode);
  const buckets = distBuckets(mode);
  return {
    played: s.played, winRate: s.winRate, curStreak: s.curStreak, maxStreak: s.maxStreak,
    distTitle: '사용한 추측 수',
    dist: buckets.map((label, i) => ({ label, count: s.distribution[i], fail: i === buckets.length - 1 })),
  };
}

/** 📋 달력 공유 문구 */
export function calendarShareText(modeId, year, month) {
  const mode = modeOf(modeId);
  const { results } = summarize(dateStrKST(), mode.id);
  return buildCalendarShareText({ results, year, month, url: SITE_URL, label: mode.id === 'standard' ? '' : mode.label });
}

/** 오늘 결과 공유 문구 — 오늘 그 모드를 아직 안 끝냈으면 null */
export async function todayShareText(modeId) {
  const mode = modeOf(modeId);
  const today = dateStrKST();
  const p = loadProgress(today, mode.id);
  if (!p || p.status === 'playing') return null;
  const res = await fetch(new URL(`../daily/${mode.fileName(today)}.json`, import.meta.url), { cache: 'no-store' });
  if (!res.ok) throw new Error(`${today} 퍼즐을 찾을 수 없음`);
  const puzzle = parsePuzzle(await res.json());
  const state = computeState(puzzle, p.guesses, { maxGuesses: mode.maxGuesses });
  const title = ['데일리 워드십', mode.id === 'standard' ? null : mode.label, today].filter(Boolean).join(' · ');
  return buildShareText({ title, puzzle, state, url: SITE_URL, maxGuesses: mode.maxGuesses });
}
