/**
 * gimmicks.js — 익스텐디드 모드의 기믹(변형 규칙) 18종과 그날의 2종 고르기 (GDD §10).
 *
 * 퍼즐에는 puzzle.gimmicks = ['wide', 'fog'] 처럼 id 목록으로 들어간다. 규칙 판정은 game.js,
 * 판 크기·구멍·함대·잠긴 칸 배치는 generator.js가 이 목록을 보고 한다.
 */
import { seedRng, shuffle, nextFloat } from '../core/random.js';

export const GIMMICKS = {
  // ── 판 ──
  wide: {
    id: 'wide', icon: '🌊', label: '넓은 바다', short: '10×10', size: 10,
    help: '해역이 10×10으로 넓어져요.',
  },
  narrow: {
    id: 'narrow', icon: '🏝️', label: '좁은 바다', short: '7×7', size: 7,
    help: '해역이 7×7로 좁아져요. 함대는 그대로라 빽빽해요.',
  },
  donut: {
    id: 'donut', icon: '🍩', label: '도넛 바다', short: '12×12 · 가운데 구멍', size: 12, hole: 4,
    help: '해역이 12×12이고, 가운데 4×4는 뚫려 있어요. 구멍에는 함선이 없고, 추측이 구멍을 지나갈 수 없어요.',
  },
  // ── 함대 ──
  extra4: {
    id: 'extra4', icon: '🚢', label: '4칸 증원', short: '4칸 함선 +1척', extra: 4,
    help: '4칸 함선이 1척 더 있어요.',
  },
  extra3: {
    id: 'extra3', icon: '⛴️', label: '3칸 증원', short: '3칸 함선 +1척', extra: 3,
    help: '3칸 함선이 1척 더 있어요.',
  },
  extra2: {
    id: 'extra2', icon: '🚤', label: '2칸 증원', short: '2칸 함선 +1척', extra: 2,
    help: '2칸 함선이 1척 더 있어요.',
  },
  // ── 정보 가리기 ──
  fog: {
    id: 'fog', icon: '🔒', label: '잠긴 칸', short: '일부 초성 숨김',
    help: '일부 칸은 초성까지 가려져 있어요. 잠긴 칸 자리에는 아무 초성의 글자나 넣을 수 있고, 한 번 추측에 포함하면 초성이 드러나요.',
  },
  cross: {
    id: 'cross', icon: '❌', label: '대각선 잠김', short: 'X자 초성 숨김',
    help: '판의 두 대각선(X자) 위 칸이 잠겨 있어요. 잠긴 칸 규칙은 \'잠긴 칸\'과 같아요.',
  },
  // ── 추측 비용 ──
  costly: {
    id: 'costly', icon: '3️⃣', label: '길이 3 선호', short: '2·4글자 헛방 −2 · 격침 +1',
    help: '3글자가 아닌 단어(2글자·4글자)로 추측했는데 함선을 완성하지 못하면 추측이 1번 더 줄어요. 대신 함선 이름을 맞혀 완성하면 추측이 1번 돌아와요.',
  },
  checkpoint: {
    id: 'checkpoint', icon: '🚩', label: '관문', short: '10·20·30번째 격침 필수',
    help: '10번째 · 20번째 · 30번째 추측은 함선을 완성해야 해요. 못 하면 그때마다 추측이 5번 더 줄어요.',
  },
  // ── 추측 제한 (어기면 거절, 횟수는 안 씀) ──
  alternate: {
    id: 'alternate', icon: '🔀', label: '길이 바꾸기', short: '직전과 다른 길이',
    help: '직전 추측과 같은 길이의 단어로는 추측할 수 없어요. 3글자 다음엔 2글자나 4글자로.',
  },
  turn: {
    id: 'turn', icon: '🧭', label: '방향 바꾸기', short: '직전과 다른 방향',
    help: '직전 추측과 같은 방향(→ ↓ ↘ ↗)으로는 추측할 수 없어요.',
  },
  apart: {
    id: 'apart', icon: '↔️', label: '거리 두기', short: '직전 칸 주변 금지',
    help: '직전에 추측한 칸과 그 둘레 8칸(대각선 포함)은 이번 추측에 쓸 수 없어요. 판에 빗금으로 표시돼요.',
  },
  lineStart: {
    id: 'lineStart', icon: '⏮️', label: '첫 칸 십자', short: '직전 첫 칸의 행·열 금지',
    help: '직전 추측의 첫 칸(1번)이 있는 가로줄과 세로줄 전체는 이번 추측에 쓸 수 없어요. 판에 빗금으로 표시돼요.',
  },
  lineEnd: {
    id: 'lineEnd', icon: '⏭️', label: '끝 칸 십자', short: '직전 끝 칸의 행·열 금지',
    help: '직전 추측의 마지막 칸이 있는 가로줄과 세로줄 전체는 이번 추측에 쓸 수 없어요. 판에 빗금으로 표시돼요.',
  },
  noOrange: {
    id: 'noOrange', icon: '🟧', label: '연속 주황 금지', short: '주황 칸 두 번 연속 ✕',
    help: '주황 칸을 포함한 추측을 두 번 연달아 할 수 없어요. 직전 추측이 주황 칸을 지나갔다면 이번엔 주황 칸을 피해야 해요.',
  },
  noMiss: {
    id: 'noMiss', icon: '🚫', label: '회색 칸 금지', short: '빈 바다 칸 금지',
    help: '이미 빈 바다로 확인된 회색 칸은 추측에 쓸 수 없어요.',
  },
  gray3: {
    id: 'gray3', icon: '🔁', label: '회색 칸 필수', short: '3번째마다 회색 포함',
    help: '3번째 · 6번째 · 9번째 … 추측은 회색(빈 바다) 칸을 하나 이상 포함해야 해요. 판에 회색 칸이 아직 없으면 괜찮아요.',
  },
};
export const GIMMICK_IDS = Object.keys(GIMMICKS);
export const GIMMICKS_PER_DAY = 2;

/** 같은 날 함께 나오면 안 되는 짝 — 판 크기끼리, 회색 칸 금지 ↔ 회색 칸 필수 */
const EXCLUSIVE = [['wide', 'narrow'], ['wide', 'donut'], ['narrow', 'donut'], ['noMiss', 'gray3']];

/** '잠긴 칸' 기믹이 잠그는 칸 비율 — 8×8에서 11칸, 10×10에서 17칸 */
export const FOG_RATIO = 1 / 6;
/** '관문' — 이 번째 추측은 함선을 완성해야 하고, 못 하면 추측이 PENALTY만큼 더 준다 */
export const CHECKPOINTS = [10, 20, 30];
export const CHECKPOINT_PENALTY = 5;
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

// 가능한 2종 조합 (함께 못 나오는 짝 제외) — 18종이면 153 − 4 = 149개
export const GIMMICK_PAIRS = GIMMICK_IDS.flatMap((a, i) => GIMMICK_IDS.slice(i + 1).map((b) => [a, b]))
  .filter(([a, b]) => !EXCLUSIVE.some(([x, y]) => (a === x && b === y) || (a === y && b === x)));
const EPOCH = Date.UTC(2026, 8, 23); // 워드십 데일리 첫날 — 여기서부터 조합 수만큼의 날마다 한 바퀴

function cycleOrder(cycle) {
  seedRng(`extended-gimmicks:${cycle}`);
  try { return shuffle([...GIMMICK_PAIRS]); } finally { seedRng(); }
}

/**
 * 그날의 기믹 2종. 조합 수(149)일에 한 바퀴씩 모든 조합을 한 번씩 돌린다(바퀴마다 순서는 섞음) —
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
