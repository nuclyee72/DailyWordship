/**
 * game.js — 데일리 워십 규칙 (순수 함수). GDD §2~§4.
 *
 * 퍼즐 = { onsets: string[64], ships: [{ len, r, c, dir, name }] }
 * 진행 = 추측 목록 [{ r, c, dir, len, word }] 하나뿐이다. 화면 상태는 항상
 * computeState(puzzle, guesses)로 처음부터 다시 계산한다 — 저장 형식이 단순해지고,
 * 같은 입력이면 언제나 같은 결과가 나온다.
 */
import { onsetOf } from '../core/hangul.js';
import { CELL_COUNT, MIN_BOX, MAX_BOX, boxCells, sameBox } from './board.js';

/** 함대 — 4칸 1척, 3칸 2척, 2칸 1척 (시뮬레이션으로 정함, GDD §5.3) */
export const FLEET = [4, 3, 3, 2];
export const MAX_GUESSES = 15;

/** 칸 번호 → { ship: 함선 번호, pos: 함명 안의 위치 } (빈 칸은 null) */
export function shipMap(puzzle) {
  const map = new Array(CELL_COUNT).fill(null);
  puzzle.ships.forEach((ship, s) => {
    boxCells(ship).forEach((idx, pos) => { map[idx] = { ship: s, pos }; });
  });
  return map;
}

/**
 * 추측이 규칙에 맞는지. 맞지 않으면 { ok: false, reason } — 이때는 추측 횟수를 쓰지 않는다.
 * @param {{has: (w: string) => boolean} | null} dict  null이면 사전 검사를 건너뛴다(테스트·시뮬레이션용)
 */
export function validateGuess(puzzle, guesses, box, rawWord, dict) {
  const cells = box && box.len >= MIN_BOX && box.len <= MAX_BOX ? boxCells(box) : null;
  if (!cells) return { ok: false, reason: '2~4칸 직선을 골라 주세요' };
  const word = (rawWord ?? '').normalize('NFC').replace(/\s+/g, '');
  const chars = [...word];
  if (chars.length !== box.len) return { ok: false, reason: `${box.len}글자 단어를 입력해 주세요` };
  for (let i = 0; i < chars.length; i++) {
    const on = onsetOf(chars[i]);
    if (!on) return { ok: false, reason: '완성된 한글만 입력할 수 있어요' };
    if (on !== puzzle.onsets[cells[i]]) {
      return { ok: false, reason: `${i + 1}번째 글자 초성이 ${puzzle.onsets[cells[i]]}이 아니에요` };
    }
  }
  if (dict && !dict.has(word)) return { ok: false, reason: '사전에 없는 단어예요' };
  if (guesses.some((g) => g.word === word && sameBox(g, box))) {
    return { ok: false, reason: '이미 해 본 추측이에요' };
  }
  return { ok: true, word };
}

/**
 * 퍼즐 + 추측 목록 → 현재 상태. maxGuesses 는 시뮬레이션에서 한도를 풀 때만 바꾼다.
 * 추측한 박스의 칸마다: 빈 칸이면 '빈칸 확인', 함선 칸이면 '명중', 음절까지 맞으면 '음절 공개'.
 * 이미 명중으로 확인된 칸(주황·노랑)을 지나는 추측은, 단어가 틀려도 그 함선의 이름을 전부 공개한다.
 * @returns {{
 *   revealed: (string|null)[],   칸별 공개된 음절 (노랑, 함선 완성 시 초록)
 *   hit: boolean[],              함선 칸으로 확인됨 (음절 공개 칸 포함)
 *   miss: boolean[],             빈 칸으로 확인됨
 *   completed: boolean[],        함선별 완성 여부
 *   results: { newCells: number[], newHits: number[], completedShips: number[] }[],  추측마다 새로 얻은 것
 *   status: 'playing'|'won'|'lost',
 * }}
 */
export function computeState(puzzle, guesses, { maxGuesses = MAX_GUESSES } = {}) {
  const map = shipMap(puzzle);
  const revealed = new Array(CELL_COUNT).fill(null);
  const hit = new Array(CELL_COUNT).fill(false);
  const miss = new Array(CELL_COUNT).fill(false);
  const completed = puzzle.ships.map(() => false);
  const results = [];
  let status = 'playing';

  for (const g of guesses) {
    if (status !== 'playing') break;
    const cells = boxCells(g);
    const chars = [...g.word];
    const newCells = [];
    const newHits = [];
    // 이번 추측 전에 이미 명중으로 확인돼 있던 칸이 지나가는 함선 → 이름 전부 공개 (GDD §4)
    const exposed = new Set(cells.filter((idx) => hit[idx] && map[idx] && !completed[map[idx].ship]).map((idx) => map[idx].ship));
    cells.forEach((idx, i) => {
      const at = map[idx];
      if (!at) { miss[idx] = true; return; }
      if (!hit[idx]) { hit[idx] = true; newHits.push(idx); }
      if (revealed[idx]) return;
      const syl = puzzle.ships[at.ship].name[at.pos];
      if (chars[i] === syl) { revealed[idx] = syl; newCells.push(idx); }
    });
    for (const s of exposed) {
      boxCells(puzzle.ships[s]).forEach((idx, pos) => {
        if (!hit[idx]) { hit[idx] = true; newHits.push(idx); }
        if (!revealed[idx]) { revealed[idx] = puzzle.ships[s].name[pos]; newCells.push(idx); }
      });
    }
    const completedShips = [];
    puzzle.ships.forEach((ship, s) => {
      if (completed[s]) return;
      if (boxCells(ship).every((idx) => revealed[idx])) { completed[s] = true; completedShips.push(s); }
    });
    results.push({ newCells, newHits, completedShips });
    if (completed.every(Boolean)) status = 'won';
    else if (results.length >= maxGuesses) status = 'lost';
  }
  return { revealed, hit, miss, completed, results, status };
}

/** 추측 하나의 칸별 결과 — 'miss'(빈 바다) | 'hit'(함선, 글자 틀림) | 'match'(글자까지 맞음). 기록 목록용 */
export function cellOutcomes(puzzle, guess, map = shipMap(puzzle)) {
  const chars = [...guess.word];
  return boxCells(guess).map((idx, i) => {
    const at = map[idx];
    if (!at) return 'miss';
    return puzzle.ships[at.ship].name[at.pos] === chars[i] ? 'match' : 'hit';
  });
}

/** 추측 하나의 결과 이모지 — 공유 문구·기록 목록용 */
export function resultEmoji(result) {
  if (result.completedShips.length) return '🟩';
  if (result.newCells.length) return '🟨';
  if (result.newHits.length) return '🟧';
  return '⬜';
}
