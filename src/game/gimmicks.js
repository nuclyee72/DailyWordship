/**
 * gimmicks.js — 익스텐디드 모드의 기믹(변형 규칙) 19종과 그날의 2종 고르기 (GDD §10).
 *
 * 퍼즐에는 puzzle.gimmicks = ['wide', 'fog'] 처럼 id 목록으로 들어간다. 규칙 판정은 game.js,
 * 판 크기·구멍·함대·잠긴 칸 배치는 generator.js가 이 목록을 보고 한다.
 */
import { seedRng, shuffle, nextFloat } from '../core/random.js';

// 문구 템플릿 — 모든 기믹이 같은 틀을 쓴다
//   help  : 명사형으로 끝나는 한 줄. 판 "판 N×N" · 함대 "… 추가" · 정보 "… 초성 가림(…)" · 비용 "… 못 맞히면 −N" · 제한 "… 사용 불가 / 필수"
//   short : 책갈피 배지. 짧은 명사구 (금지는 "… ✕")
//   group : 도움말에서 묶는 분류
export const GIMMICKS = {
  // ── 판 ──
  wide: { id: 'wide', group: '판', icon: '🌊', label: '넓은 바다', short: '10×10', size: 10,
    help: '판 10×10' },
  narrow: { id: 'narrow', group: '판', icon: '🏝️', label: '좁은 바다', short: '7×7', size: 7,
    help: '판 7×7' },
  donut: { id: 'donut', group: '판', icon: '🍩', label: '도넛 바다', short: '12×12 · 구멍', size: 12, hole: 4,
    help: '판 12×12, 가운데 4×4 구멍 (함선 없음 · 통과 불가)' },
  // ── 함대 ──
  extra4: { id: 'extra4', group: '함대', icon: '🚢', label: '4칸 증원', short: '+1척', extra: 4,
    help: '4칸 함선 1척 추가' },
  extra3: { id: 'extra3', group: '함대', icon: '⛴️', label: '3칸 증원', short: '+1척', extra: 3,
    help: '3칸 함선 1척 추가' },
  extra2: { id: 'extra2', group: '함대', icon: '🚤', label: '2칸 증원', short: '+1척', extra: 2,
    help: '2칸 함선 1척 추가' },
  // ── 정보 ──
  fog: { id: 'fog', group: '정보', icon: '🔒', label: '잠긴 칸', short: '초성 가림',
    help: '일부 칸 초성 가림 (아무 글자 가능 · 추측 시 공개)' },
  cross: { id: 'cross', group: '정보', icon: '❌', label: '대각선 잠김', short: '초성 가림',
    help: '두 대각선(X자) 칸 초성 가림 (아무 글자 가능 · 추측 시 공개)' },
  // ── 비용 ──
  costly: { id: 'costly', group: '비용', icon: '3️⃣', label: '길이 3 선호', short: '헛방 −2 · 격침 +1',
    help: '2·4글자로 함선 못 맞히면 −2, 함선 맞히면 +1' },
  checkpoint: { id: 'checkpoint', group: '비용', icon: '🚩', label: '관문', short: '10·20번째',
    help: '10·20번째 추측에서 함선 못 맞히면 −5' },
  lowStart: { id: 'lowStart', group: '비용', icon: '⏳', label: '보급 부족', short: '시작 −3',
    help: '시작 기회 3번 감소' },
  // ── 제한 (어기면 거절, 횟수는 안 씀) ──
  alternate: { id: 'alternate', group: '제한', icon: '🔀', label: '길이 바꾸기', short: '같은 길이 ✕',
    help: '직전 추측과 같은 길이 사용 불가' },
  turn: { id: 'turn', group: '제한', icon: '🧭', label: '방향 바꾸기', short: '같은 방향 ✕',
    help: '직전 추측과 같은 방향 사용 불가' },
  apart: { id: 'apart', group: '제한', icon: '↔️', label: '거리 두기', short: '주변 8칸 ✕',
    help: '직전 추측 칸과 주변 8칸 사용 불가' },
  lineStart: { id: 'lineStart', group: '제한', icon: '⏮️', label: '첫 칸 십자', short: '첫 칸 줄 ✕',
    help: '직전 추측 첫 칸의 가로·세로줄 사용 불가' },
  lineEnd: { id: 'lineEnd', group: '제한', icon: '⏭️', label: '끝 칸 십자', short: '끝 칸 줄 ✕',
    help: '직전 추측 끝 칸의 가로·세로줄 사용 불가' },
  noOrange: { id: 'noOrange', group: '제한', icon: '🟧', label: '연속 주황 금지', short: '연속 주황 ✕',
    help: '직전에 주황 칸을 썼으면 주황 칸 사용 불가' },
  noMiss: { id: 'noMiss', group: '제한', icon: '🚫', label: '회색 칸 금지', short: '회색 칸 ✕',
    help: '빈 바다로 확인된 회색 칸 사용 불가' },
  gray3: { id: 'gray3', group: '제한', icon: '🔁', label: '회색 칸 필수', short: '3번째마다 회색',
    help: '3번째 추측마다 회색 칸 1개 이상 필수 (회색 칸 없으면 면제)' },
};
export const GIMMICK_IDS = Object.keys(GIMMICKS);
export const GIMMICKS_PER_DAY = 2;

/** 같은 날 함께 나오면 안 되는 짝 — 판 크기끼리, 회색 칸 금지 ↔ 회색 칸 필수 */
const EXCLUSIVE = [['wide', 'narrow'], ['wide', 'donut'], ['narrow', 'donut'], ['noMiss', 'gray3']];

/** '잠긴 칸' 기믹이 잠그는 칸 비율 — 8×8에서 11칸, 10×10에서 17칸 */
export const FOG_RATIO = 1 / 6;
/** '관문' — 이 번째 추측은 함선을 완성해야 하고, 못 하면 추측이 PENALTY만큼 더 준다 */
export const CHECKPOINTS = [10, 20];
export const CHECKPOINT_PENALTY = 5;
/** '보급 부족' — 시작부터 이만큼 쓴 채로 */
export const START_PENALTY = 3;
/** '회색 칸 필수' — 이 번째마다 */
export const GRAY_EVERY = 3;

export const hasGimmick = (puzzle, id) => !!puzzle?.gimmicks?.includes(id);
/** 기믹 목록 → 판 크기 (기본 8) */
export const boardSizeFor = (gimmicks) => (gimmicks ?? []).map((id) => GIMMICKS[id].size).find(Boolean) ?? 8;
/** 기믹 목록 → 판에 뚫린 칸 번호들 ('도넛 바다'의 가운데 정사각형) */
export function holesFor(gimmicks) {
  const donut = (gimmicks ?? []).map((id) => GIMMICKS[id]).find((g) => g.hole);
  if (!donut) return [];
  const from = (donut.size - donut.hole) / 2;
  const holes = [];
  for (let r = from; r < from + donut.hole; r++) for (let c = from; c < from + donut.hole; c++) holes.push(r * donut.size + c);
  return holes;
}
/** 기본 함대 + '증원' 기믹 → 그날의 함대 (긴 함선부터) */
export const fleetFor = (fleet, gimmicks) =>
  [...fleet, ...(gimmicks ?? []).map((id) => GIMMICKS[id].extra).filter(Boolean)].sort((a, b) => b - a);
/** 공유·화면 표시용 '🌊 넓은 바다 · 🔒 잠긴 칸' */
export const gimmickLine = (gimmicks) => (gimmicks ?? []).map((id) => `${GIMMICKS[id].icon} ${GIMMICKS[id].label}`).join(' · ');

// 가능한 2종 조합 (함께 못 나오는 짝 제외) — 19종이면 171 − 4 = 167개
export const GIMMICK_PAIRS = GIMMICK_IDS.flatMap((a, i) => GIMMICK_IDS.slice(i + 1).map((b) => [a, b]))
  .filter(([a, b]) => !EXCLUSIVE.some(([x, y]) => (a === x && b === y) || (a === y && b === x)));
const EPOCH = Date.UTC(2026, 8, 23); // 워드십 데일리 첫날 — 여기서부터 조합 수만큼의 날마다 한 바퀴

function cycleOrder(cycle) {
  seedRng(`extended-gimmicks:${cycle}`);
  try { return shuffle([...GIMMICK_PAIRS]); } finally { seedRng(); }
}

/**
 * 그날의 기믹 2종. 조합 수(167)일에 한 바퀴씩 모든 조합을 한 번씩 돌린다(바퀴마다 순서는 섞음) —
 * 같은 조합이 연달아 나오지 않고, 어느 조합도 오래 빠지지 않는다.
 */
export function dailyGimmicks(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const day = Math.round((Date.UTC(y, m - 1, d) - EPOCH) / 86400000);
  const n = GIMMICK_PAIRS.length;
  const cycle = Math.floor(day / n);
  const order = cycleOrder(cycle);
  // 바퀴가 바뀌는 날, 전 바퀴 마지막 날과 같은 조합이면 둘째 날 것과 맞바꾼다
  const prevLast = cycleOrder(cycle - 1)[n - 1];
  if (order[0] === prevLast) [order[0], order[1]] = [order[1], order[0]];
  return [...order[((day % n) + n) % n]];
}

/** 자유 연습용 — 아무 2종 (현재 rng 사용: 시드를 심었으면 결정적) */
export function randomGimmicks() {
  return [...GIMMICK_PAIRS[Math.floor(nextFloat() * GIMMICK_PAIRS.length)]];
}
