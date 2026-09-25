/**
 * generator.js — 퍼즐 생성 (GDD §5). 데일리·자유 연습 공용, 시드가 같으면 결과도 같다.
 *
 *  1. 함대 배치(FLEET) — 4방향(가로·세로·대각 두 개) 무작위, 겹침만 금지(접촉 허용)
 *  2. 함명 — 출제 풀에서 길이별로 뽑는다(모두 다르게). '단순한 단어'면 초급·중급 어휘(pool.simple)에서만
 *  3. 빈 칸 초성 — 출제 풀 음절의 초성 빈도로 가중 추출
 *  4. 품질 검사 — 길이별 미끼 박스(상용어 초성열과 맞는데 함선이 아닌 박스)가 충분해야 한다.
 *     4글자는 자연 발생이 드물어 모자라면 빈 칸에 미끼를 직접 심는다.
 *  5. 익스텐디드 기믹 (GDD §10) — 판 크기(7·10·12), '도넛 바다'의 구멍(함선이 피한다), '증원'이면 함선 +1척,
 *     '잠긴 칸'·'대각선 잠김'이면 가릴 칸을 정한다. 판이 8×8이 아니면 미끼 최소 개수를 박스 수에 비례해 맞춘다.
 */
import { onsetsOf, CHO } from '../core/hangul.js';
import { seedRng, nextFloat, shuffle, pick } from '../core/random.js';
import { DIR_KEYS, boardOf, geoOf, sameBox } from './board.js';
import { FLEET, HOLE_ONSET } from './game.js';
import { FOG_RATIO, boardSizeFor, fleetFor, holesFor } from './gimmicks.js';

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

function placeFleet(fleet, geo, holes) {
  const occupied = new Array(geo.cellCount).fill(false);
  for (const idx of holes) occupied[idx] = true;
  const ships = [];
  for (const len of fleet) {
    const options = [];
    for (const dir of DIR_KEYS) {
      for (let r = 0; r < geo.size; r++) {
        for (let c = 0; c < geo.size; c++) {
          const box = { r, c, dir, len };
          const cells = geo.boxCells(box);
          if (cells && cells.every((i) => !occupied[i])) options.push(box);
        }
      }
    }
    if (!options.length) return null;
    const box = pick(options);
    geo.boxCells(box).forEach((i) => { occupied[i] = true; });
    ships.push(box);
  }
  return ships;
}

/** 길이별 미끼 박스 수 (함선 박스 자신은 제외) */
export function countDecoys(puzzle, pool) {
  const geo = geoOf(puzzle);
  const counts = {};
  for (const len of [2, 3, 4]) {
    counts[len] = geo.allBoxes(len).filter((box) => {
      if (puzzle.ships.some((s) => sameBox(s, box))) return false;
      const pattern = geo.boxCells(box).map((i) => puzzle.onsets[i]).join('');
      return pool.matching(pattern).length > 0;
    }).length;
  }
  return counts;
}

/** 빈 칸만 쓰는 4칸 박스에 출제어 초성열을 심는다 */
function plantDecoy(onsets, occupied, pool, geo) {
  const free = shuffle(geo.allBoxes(4).filter((b) => geo.boxCells(b).every((i) => !occupied[i])));
  if (!free.length) return false;
  const pattern = onsetsOf(pick(pool.words[4]));
  geo.boxCells(free[0]).forEach((i, k) => { onsets[i] = pattern[k]; });
  return true;
}

/** 처음에 초성을 가릴 칸 — '대각선 잠김'은 두 대각선 전부, '잠긴 칸'은 (대각선 밖에서) 판 칸 수의 FOG_RATIO. 구멍은 빼고 */
function lockedCells(gimmicks, geo, holes) {
  const locked = new Set();
  const isHole = new Set(holes);
  if (gimmicks.includes('cross')) {
    for (let r = 0; r < geo.size; r++) { locked.add(geo.idxOf(r, r)); locked.add(geo.idxOf(r, geo.size - 1 - r)); }
    isHole.forEach((i) => locked.delete(i));
  }
  if (gimmicks.includes('fog')) {
    const rest = shuffle([...Array(geo.cellCount).keys()].filter((i) => !locked.has(i) && !isHole.has(i)));
    rest.slice(0, Math.round((geo.cellCount - isHole.size) * FOG_RATIO)).forEach((i) => locked.add(i));
  }
  return [...locked].sort((a, b) => a - b);
}

/** '단순한 단어' — 길이별 함명 후보. 목록이 비었으면(데이터 없음) 알려 준다 */
function simpleNames(pool) {
  const names = Object.fromEntries([2, 3, 4].map((len) => [len, pool.words[len].filter((w) => pool.simple?.has(w))]));
  if ([2, 3, 4].some((len) => !names[len].length)) throw new Error('단순한 단어 목록(answers-simple.txt)이 비어 있어요');
  return names;
}

/** 8×8 기준 미끼 최소 개수를 이 판의 (구멍을 안 지나는) 박스 수에 비례하게 */
function scaleDecoys(minDecoys, geo, holes) {
  const isHole = new Set(holes);
  const base = boardOf(8);
  return Object.fromEntries([2, 3, 4].map((len) => {
    const here = geo.allBoxes(len).filter((b) => geo.boxCells(b).every((i) => !isHole.has(i))).length;
    return [len, Math.floor((minDecoys[len] * here) / base.allBoxes(len).length)];
  }));
}

function attempt(pool, names, weights, minDecoys, fleet, geo, holes) {
  const ships = placeFleet(fleet, geo, holes);
  if (!ships) return null;

  const used = new Set();
  for (const ship of ships) {
    let name;
    for (let tries = 0; tries < 50 && (!name || used.has(name)); tries++) name = pick(names[ship.len]);
    if (used.has(name)) return null;
    used.add(name);
    ship.name = name;
  }

  const { size, cellCount } = geo;
  const onsets = new Array(cellCount).fill(null);
  const occupied = new Array(cellCount).fill(false);
  for (const idx of holes) { onsets[idx] = HOLE_ONSET; occupied[idx] = true; }
  for (const ship of ships) {
    geo.boxCells(ship).forEach((idx, pos) => { onsets[idx] = onsetsOf(ship.name)[pos]; occupied[idx] = true; });
  }
  for (let idx = 0; idx < cellCount; idx++) {
    if (onsets[idx]) continue;
    // 드문 된소리 초성이 왼쪽·위쪽과 연달아 붙지 않게 (데드존 방지)
    let o = drawOnset(weights);
    const left = idx % size ? onsets[idx - 1] : null;
    const up = idx >= size ? onsets[idx - size] : null;
    while (RARE.has(o) && (RARE.has(left) || RARE.has(up))) o = drawOnset(weights);
    onsets[idx] = o;
  }

  const puzzle = { size, holes, onsets, ships };
  for (let planted = 0; countDecoys(puzzle, pool)[4] < minDecoys[4] && planted < 6; planted++) {
    if (!plantDecoy(onsets, occupied, pool, geo)) break;
  }
  const decoys = countDecoys(puzzle, pool);
  if ([2, 3, 4].some((len) => decoys[len] < minDecoys[len])) return null;
  return puzzle;
}

/**
 * @param {string} seed  데일리는 'daily:YYYY-MM-DD', 자유 연습은 임의 문자열
 * @param {ReturnType<import('../core/dictionary.js').buildAnswerPool>} pool
 * @param {{ minDecoys?: object, fleet?: number[], gimmicks?: string[] }} [opts]  gimmicks — 익스텐디드 기믹 id 목록
 * @returns {{ size: number, gimmicks: string[], locked: number[], holes: number[], onsets: string[], ships: {len,r,c,dir,name}[] }}
 *   fleet 은 기본 함대 — '증원' 기믹의 함선은 여기에 더해진다
 */
export function generatePuzzle(seed, pool, { minDecoys = DEFAULT_MIN_DECOYS, fleet = FLEET, gimmicks = [] } = {}) {
  seedRng(seed);
  try {
    const geo = boardOf(boardSizeFor(gimmicks));
    const fullFleet = gimmicks.length ? fleetFor(fleet, gimmicks) : fleet;
    const holes = holesFor(gimmicks);
    const decoys = geo.size === 8 && !holes.length ? minDecoys : scaleDecoys(minDecoys, geo, holes);
    const weights = onsetWeights(pool);
    // 함명 후보 — '단순한 단어'면 초급·중급 어휘만 (미끼 계산·빈 칸 초성은 전체 출제 풀 그대로)
    const names = gimmicks.includes('simple') ? simpleNames(pool) : pool.words;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const puzzle = attempt(pool, names, weights, decoys, fullFleet, geo, holes);
      if (puzzle) {
        // 기믹 없는 판은 잠금 추첨을 하지 않는다 — 같은 시드의 스탠다드·사자성어 판이 예전과 똑같이 나오게
        const locked = gimmicks.length ? lockedCells(gimmicks, geo, holes) : [];
        return { size: puzzle.size, gimmicks: [...gimmicks], locked, holes, onsets: puzzle.onsets, ships: puzzle.ships };
      }
    }
    throw new Error(`퍼즐 생성 실패 (seed=${seed})`);
  } finally {
    seedRng(); // 다른 코드가 쓰는 난수는 다시 Math.random으로
  }
}
