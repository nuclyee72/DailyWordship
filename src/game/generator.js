/**
 * generator.js — 퍼즐 생성 (GDD §5). 데일리·자유 연습 공용, 시드가 같으면 결과도 같다.
 *
 *  1. 함대 배치(FLEET) — 4방향(가로·세로·대각 두 개) 무작위, 겹침만 금지(접촉 허용)
 *  2. 함명 — 출제 풀에서 길이별로 뽑는다(모두 다르게)
 *  3. 빈 칸 초성 — 출제 풀 음절의 초성 빈도로 가중 추출
 *  4. 품질 검사 — 길이별 미끼 박스(상용어 초성열과 맞는데 함선이 아닌 박스)가 충분해야 한다.
 *     4글자는 자연 발생이 드물어 모자라면 빈 칸에 미끼를 직접 심는다.
 */
import { onsetsOf, CHO } from '../core/hangul.js';
import { seedRng, nextFloat, shuffle, pick } from '../core/random.js';
import { CELL_COUNT, DIR_KEYS, SIZE, allBoxes, boxCells, sameBox } from './board.js';
import { FLEET } from './game.js';

/** 길이별 최소 미끼 박스 수 — scripts/simulate.mjs 측정으로 정한 값 (GDD §5.3) */
export const DEFAULT_MIN_DECOYS = { 2: 150, 3: 40, 4: 4 };
const RARE = new Set(['ㄲ', 'ㄸ', 'ㅃ', 'ㅆ', 'ㅉ']);
const MAX_ATTEMPTS = 200;

function onsetWeights(pool) {
  const count = new Map(CHO.map((c) => [c, 0]));
  for (const len of Object.keys(pool.words)) {
    for (const w of pool.words[len]) for (const o of onsetsOf(w)) count.set(o, count.get(o) + 1);
  }
  const total = [...count.values()].reduce((a, b) => a + b, 0);
  let acc = 0;
  return [...count].filter(([, n]) => n > 0).map(([c, n]) => { acc += n / total; return [c, acc]; });
}

function drawOnset(cumulative) {
  const x = nextFloat();
  for (const [c, upTo] of cumulative) if (x < upTo) return c;
  return cumulative[cumulative.length - 1][0];
}

function placeFleet(fleet) {
  const occupied = new Array(CELL_COUNT).fill(false);
  const ships = [];
  for (const len of fleet) {
    const options = [];
    for (const dir of DIR_KEYS) {
      for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
          const box = { r, c, dir, len };
          const cells = boxCells(box);
          if (cells && cells.every((i) => !occupied[i])) options.push(box);
        }
      }
    }
    if (!options.length) return null;
    const box = pick(options);
    boxCells(box).forEach((i) => { occupied[i] = true; });
    ships.push(box);
  }
  return ships;
}

/** 길이별 미끼 박스 수 (함선 박스 자신은 제외) */
export function countDecoys(puzzle, pool) {
  const counts = {};
  for (const len of [2, 3, 4]) {
    counts[len] = allBoxes(len).filter((box) => {
      if (puzzle.ships.some((s) => sameBox(s, box))) return false;
      const pattern = boxCells(box).map((i) => puzzle.onsets[i]).join('');
      return pool.matching(pattern).length > 0;
    }).length;
  }
  return counts;
}

/** 빈 칸만 쓰는 4칸 박스에 출제어 초성열을 심는다 */
function plantDecoy(onsets, occupied, pool) {
  const free = shuffle(allBoxes(4).filter((b) => boxCells(b).every((i) => !occupied[i])));
  if (!free.length) return false;
  const pattern = onsetsOf(pick(pool.words[4]));
  boxCells(free[0]).forEach((i, k) => { onsets[i] = pattern[k]; });
  return true;
}

function attempt(pool, weights, minDecoys, fleet) {
  const ships = placeFleet(fleet);
  if (!ships) return null;

  const used = new Set();
  for (const ship of ships) {
    let name;
    for (let tries = 0; tries < 50 && (!name || used.has(name)); tries++) name = pick(pool.words[ship.len]);
    if (used.has(name)) return null;
    used.add(name);
    ship.name = name;
  }

  const onsets = new Array(CELL_COUNT).fill(null);
  const occupied = new Array(CELL_COUNT).fill(false);
  for (const ship of ships) {
    boxCells(ship).forEach((idx, pos) => { onsets[idx] = onsetsOf(ship.name)[pos]; occupied[idx] = true; });
  }
  for (let idx = 0; idx < CELL_COUNT; idx++) {
    if (onsets[idx]) continue;
    // 드문 된소리 초성이 왼쪽·위쪽과 연달아 붙지 않게 (데드존 방지)
    let o = drawOnset(weights);
    const left = idx % SIZE ? onsets[idx - 1] : null;
    const up = idx >= SIZE ? onsets[idx - SIZE] : null;
    while (RARE.has(o) && (RARE.has(left) || RARE.has(up))) o = drawOnset(weights);
    onsets[idx] = o;
  }

  const puzzle = { onsets, ships };
  for (let planted = 0; countDecoys(puzzle, pool)[4] < minDecoys[4] && planted < 6; planted++) {
    if (!plantDecoy(onsets, occupied, pool)) break;
  }
  const decoys = countDecoys(puzzle, pool);
  if ([2, 3, 4].some((len) => decoys[len] < minDecoys[len])) return null;
  return puzzle;
}

/**
 * @param {string} seed  데일리는 'daily:YYYY-MM-DD', 자유 연습은 임의 문자열
 * @param {ReturnType<import('../core/dictionary.js').buildAnswerPool>} pool
 * @returns {{ onsets: string[], ships: {len,r,c,dir,name}[] }}
 */
export function generatePuzzle(seed, pool, { minDecoys = DEFAULT_MIN_DECOYS, fleet = FLEET } = {}) {
  seedRng(seed);
  try {
    const weights = onsetWeights(pool);
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const puzzle = attempt(pool, weights, minDecoys, fleet);
      if (puzzle) return puzzle;
    }
    throw new Error(`퍼즐 생성 실패 (seed=${seed})`);
  } finally {
    seedRng(); // 다른 코드가 쓰는 난수는 다시 Math.random으로
  }
}
