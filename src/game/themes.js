/**
 * themes.js — 함명 주제(동물·음식·…)와 그날의 주제 고르기.
 *
 * 주제별 단어는 src/data/themes.json (2~4글자 섞어서, 전부 출제 풀 answers-{2,3,4}.txt 안의 말).
 * 주제가 있는 판은 함명을 그 주제 단어에서 먼저 뽑고, 그 길이의 주제 단어가 모자랄 때만 출제 풀 전체에서
 * 채운다(src/game/generator.js). 퍼즐에는 puzzle.theme = '동물' 처럼 들어간다.
 */
import { seedRng, shuffle } from '../core/random.js';

export const THEMES = {
  동물: { id: '동물', icon: '🐾' },
  음식: { id: '음식', icon: '🍚' },
  식물: { id: '식물', icon: '🌿' },
  몸: { id: '몸', icon: '💪' },
  자연: { id: '자연', icon: '⛰️' },
  사람: { id: '사람', icon: '🧑' },
  물건: { id: '물건', icon: '🧰' },
  장소: { id: '장소', icon: '🏠' },
  마음: { id: '마음', icon: '💗' },
  시간: { id: '시간', icon: '⏰' },
  취미: { id: '취미', icon: '🎨' },
};
export const THEME_IDS = Object.keys(THEMES);

/** 화면 표시용 '🐾 동물' */
export const themeLabel = (id) => (THEMES[id] ? `${THEMES[id].icon} ${id}` : '');

/** themes.json 내용 → 주제별 단어 Set */
export const buildThemeWords = (json) => Object.fromEntries(Object.entries(json).map(([id, words]) => [id, new Set(words)]));

const EPOCH = Date.UTC(2026, 8, 23); // 워드십 데일리 첫날 (gimmicks.js와 같은 기준)

function cycleOrder(modeId, cycle) {
  seedRng(`theme:${modeId}:${cycle}`);
  try { return shuffle([...THEME_IDS]); } finally { seedRng(); }
}

/**
 * 그날 그 모드의 주제. 주제 수(11)일에 한 바퀴씩 모든 주제를 한 번씩 돌린다(바퀴마다 순서는 섞고,
 * 모드마다 따로 섞음) — 이틀 연속 같은 주제가 안 나오고, 어느 주제도 오래 빠지지 않는다.
 */
export function dailyTheme(dateStr, modeId) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const day = Math.round((Date.UTC(y, m - 1, d) - EPOCH) / 86400000);
  const n = THEME_IDS.length;
  const cycle = Math.floor(day / n);
  const order = cycleOrder(modeId, cycle);
  // 바퀴가 바뀌는 날, 전 바퀴 마지막 날과 같은 주제면 둘째 날 것과 맞바꾼다
  if (order[0] === cycleOrder(modeId, cycle - 1)[n - 1]) [order[0], order[1]] = [order[1], order[0]];
  return order[((day % n) + n) % n];
}

/** 자유 연습용 — 아무 주제 */
export const randomTheme = () => THEME_IDS[Math.floor(Math.random() * THEME_IDS.length)];
