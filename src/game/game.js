/**
 * game.js — 워드십 규칙 (순수 함수). GDD §2~§4, 익스텐디드 기믹 §10.
 *
 * 퍼즐 = { size, gimmicks, locked, holes, onsets: string[size²], ships: [{ len, r, c, dir, name }] }
 *   size 8(기본)·7·10·12 / gimmicks 기믹 id 목록 / locked 처음에 초성이 가려진 칸 번호들
 *   holes '도넛 바다'의 뚫린 칸 — 판이 아니다: 함선이 없고 박스가 지나갈 수 없다 (onsets 자리는 HOLE_ONSET)
 * 진행 = 추측 목록 [{ r, c, dir, len, word }] 하나뿐이다. 화면 상태는 항상
 * computeState(puzzle, guesses)로 처음부터 다시 계산한다 — 저장 형식이 단순해지고,
 * 같은 입력이면 언제나 같은 결과가 나온다.
 */
import { onsetOf } from '../core/hangul.js';
import { MIN_BOX, MAX_BOX, DEFAULT_SIZE, DIR_ARROW, geoOf, sameBox } from './board.js';
import { hasGimmick, CHECKPOINTS, CHECKPOINT_PENALTY, GRAY_EVERY } from './gimmicks.js';

/** 함대 — 4칸 1척, 3칸 3척, 2칸 2척 (GDD §3) */
export const FLEET = [4, 3, 3, 3, 2, 2];
export const MAX_GUESSES = 30;
/** 뚫린 칸의 초성 자리 — 어떤 단어의 초성열과도 맞지 않아서 미끼 계산에서 저절로 빠진다 */
export const HOLE_ONSET = '■';

/** 데일리 파일(JSON) → 퍼즐. 기믹이 없던 예전 파일은 8×8 · 기믹 없음 */
export function parsePuzzle(data) {
  return {
    size: data.size ?? DEFAULT_SIZE,
    gimmicks: data.gimmicks ?? [],
    locked: data.locked ?? [],
    holes: data.holes ?? [],
    onsets: [...data.onsets],
    ships: data.ships,
  };
}

/** 칸 번호 → { ship: 함선 번호, pos: 함명 안의 위치 } (빈 칸은 null) */
export function shipMap(puzzle) {
  const geo = geoOf(puzzle);
  const map = new Array(geo.cellCount).fill(null);
  puzzle.ships.forEach((ship, s) => {
    geo.boxCells(ship).forEach((idx, pos) => { map[idx] = { ship: s, pos }; });
  });
  return map;
}

/**
 * 지금까지의 추측으로 정해지는, 다음 추측에 걸리는 제약 (기믹 — GDD §10).
 * 기믹끼리 겹쳐 고를 수 있는 박스가 하나도 없게 되면, 그 한 번은 직전 추측에 따른 제약을 모두 푼다(relaxed).
 * @returns {{
 *   hidden: boolean[],     아직 초성이 가려진 칸 ('잠긴 칸'·'대각선 잠김' — 한 번 추측에 포함되면 풀린다)
 *   holes: boolean[],      판에 뚫린 칸 ('도넛 바다')
 *   blocked: (string|null)[],  이번 추측에 쓸 수 없는 칸과 그 이유 — 거리 두기 · 첫/끝 칸 십자 · 연속 주황 금지 · 회색 칸 금지
 *   banLen: number|null,   이번 추측에 쓸 수 없는 길이 ('길이 바꾸기')
 *   banDir: string|null,   이번 추측에 쓸 수 없는 방향 ('방향 바꾸기')
 *   mustGray: boolean,     이번 추측은 회색(빈 바다) 칸을 포함해야 함 ('회색 칸 필수')
 *   miss: boolean[],       빈 바다로 확인된 칸 (mustGray 판정용)
 *   relaxed: boolean,      둘 곳이 없어 이번 한 번 제약을 풀었음
 * }}
 */
export function guessRules(puzzle, guesses) {
  const rules = strictRules(puzzle, guesses);
  const constrained = rules.banLen || rules.banDir || rules.mustGray || rules.blocked.some(Boolean);
  if (!constrained) return rules;
  const geo = geoOf(puzzle);
  const anyOk = [4, 3, 2].some((len) => geo.allBoxes(len).some((b) => !boxProblem(puzzle, guesses, b, rules)));
  if (anyOk) return rules;
  return { ...rules, blocked: rules.blocked.map(() => null), banLen: null, banDir: null, mustGray: false, relaxed: true };
}

function strictRules(puzzle, guesses) {
  const geo = geoOf(puzzle);
  const hidden = new Array(geo.cellCount).fill(false);
  for (const idx of puzzle.locked ?? []) hidden[idx] = true;
  for (const g of guesses) for (const idx of geo.boxCells(g)) hidden[idx] = false;
  const holes = new Array(geo.cellCount).fill(false);
  for (const idx of puzzle.holes ?? []) holes[idx] = true;
  const has = (id) => hasGimmick(puzzle, id);
  // 판 상태(명중·빈 바다)가 필요한 기믹만 상태를 계산한다
  const st = has('noOrange') || has('noMiss') || has('gray3') ? computeState(puzzle, guesses, { maxGuesses: Infinity }) : null;
  const last = guesses[guesses.length - 1];
  const blocked = new Array(geo.cellCount).fill(null);
  const block = (idx, reason) => { blocked[idx] ??= reason; };
  if (has('noMiss')) {
    st.miss.forEach((m, idx) => { if (m) block(idx, '회색 칸 금지 — 빈 바다로 확인된 칸은 쓸 수 없어요'); });
  }
  if (last) {
    const lastCells = geo.boxCells(last);
    if (has('apart')) {
      for (const idx of lastCells) {
        block(idx, '거리 두기 — 직전 추측과 붙은 칸은 쓸 수 없어요');
        for (const n of geo.neighbors(idx)) block(n, '거리 두기 — 직전 추측과 붙은 칸은 쓸 수 없어요');
      }
    }
    // 직전 추측의 첫/끝 칸을 지나는 가로줄·세로줄 전체
    const blockLines = (idx, reason) => {
      const r = geo.rowOf(idx), c = geo.colOf(idx);
      for (let k = 0; k < geo.size; k++) { block(geo.idxOf(r, k), reason); block(geo.idxOf(k, c), reason); }
    };
    if (has('lineStart')) blockLines(lastCells[0], '첫 칸 십자 — 직전 첫 칸의 가로줄·세로줄은 쓸 수 없어요');
    if (has('lineEnd')) blockLines(lastCells[lastCells.length - 1], '끝 칸 십자 — 직전 끝 칸의 가로줄·세로줄은 쓸 수 없어요');
    // 직전 추측이 주황 칸을 지나갔으면, 지금 주황인 칸은 이번에 못 쓴다
    if (has('noOrange') && st.results[st.results.length - 1]?.usedOrange) {
      st.hit.forEach((h, idx) => { if (h && !st.revealed[idx]) block(idx, '연속 주황 금지 — 직전에 주황 칸을 썼으니 이번엔 주황 칸을 피해 주세요'); });
    }
  }
  const banLen = last && has('alternate') ? last.len : null;
  const banDir = last && has('turn') ? last.dir : null;
  const mustGray = has('gray3') && (guesses.length + 1) % GRAY_EVERY === 0 && st.miss.some(Boolean);
  return { hidden, holes, blocked, banLen, banDir, mustGray, miss: st?.miss ?? null, relaxed: false };
}

/** 박스 자체를 이번에 고를 수 있는지. 안 되면 이유 문자열, 되면 null */
export function boxProblem(puzzle, guesses, box, rules = guessRules(puzzle, guesses)) {
  const cells = box && box.len >= MIN_BOX && box.len <= MAX_BOX ? geoOf(puzzle).boxCells(box) : null;
  if (!cells) return '2~4칸 직선을 골라 주세요';
  if (cells.some((idx) => rules.holes[idx])) return '도넛 바다 — 가운데 구멍은 지나갈 수 없어요';
  if (rules.banLen === box.len) return `길이 바꾸기 — 직전이 ${box.len}글자라 이번엔 다른 길이로`;
  if (rules.banDir === box.dir) return `방향 바꾸기 — 직전이 ${DIR_ARROW[box.dir]} 방향이라 이번엔 다른 방향으로`;
  const blockedAt = cells.find((idx) => rules.blocked[idx]);
  if (blockedAt !== undefined) return rules.blocked[blockedAt];
  if (rules.mustGray && !cells.some((idx) => rules.miss[idx])) return `회색 칸 필수 — ${GRAY_EVERY}번째 추측마다 회색(빈 바다) 칸을 하나 이상 포함해야 해요`;
  return null;
}

/**
 * n번째 추측 하나가 쓰는 횟수 — { cost, bonus, penalty }, 실제로 줄어드는 수는 cost − bonus + penalty.
 * 보통 cost 1. '길이 3 선호'면 3글자가 아닌 헛방(함선 완성 못 함)은 cost 2, 함선을 완성하면 bonus 1(+1 돌려받음).
 * '관문'이면 10·20·30번째 추측에서 함선을 완성하지 못하면 penalty 5.
 */
export function guessCost(puzzle, len, completedAny, n = 0) {
  const costly = hasGimmick(puzzle, 'costly');
  const penalty = hasGimmick(puzzle, 'checkpoint') && CHECKPOINTS.includes(n) && !completedAny ? CHECKPOINT_PENALTY : 0;
  if (completedAny) return { cost: 1, bonus: costly ? 1 : 0, penalty };
  return { cost: costly && len !== 3 ? 2 : 1, bonus: 0, penalty };
}

/**
 * 추측이 규칙에 맞는지. 맞지 않으면 { ok: false, reason } — 이때는 추측 횟수를 쓰지 않는다.
 * @param {{has: (w: string) => boolean} | null} dict  null이면 사전 검사를 건너뛴다(테스트·시뮬레이션용)
 */
export function validateGuess(puzzle, guesses, box, rawWord, dict) {
  const rules = guessRules(puzzle, guesses);
  const problem = boxProblem(puzzle, guesses, box, rules);
  if (problem) return { ok: false, reason: problem };
  const cells = geoOf(puzzle).boxCells(box);
  const word = (rawWord ?? '').normalize('NFC').replace(/\s+/g, '');
  const chars = [...word];
  if (chars.length !== box.len) return { ok: false, reason: `${box.len}글자 단어를 입력해 주세요` };
  for (let i = 0; i < chars.length; i++) {
    const on = onsetOf(chars[i]);
    if (!on) return { ok: false, reason: '완성된 한글만 입력할 수 있어요' };
    if (rules.hidden[cells[i]]) continue; // 잠긴 칸 — 아무 초성이나
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
 * 힌트 — 박스가 이미 명중으로 확인된 주황 칸(글자 미공개)을 지나면, 그중 박스에서 가장 앞(번호가 낮은)
 *   칸 하나의 글자를 틀렸어도 노랑으로 공개한다. 박스 밖 칸은 절대 열리지 않는다.
 * 완성(초록) — 함선 자리에 함선 이름을 정확히 입력했을 때만. 글자가 전부 노랑이어도 이름을 입력해야 초록.
 * 추측 소모 — 보통 1번. 기믹에 따라 벌점·보상이 붙는다 (guessCost).
 * @returns {{
 *   revealed: (string|null)[],   칸별 공개된 음절 (노랑, 함선 완성 시 초록)
 *   hit: boolean[],              함선 칸으로 확인됨 (음절 공개 칸 포함)
 *   miss: boolean[],             빈 칸으로 확인됨
 *   completed: boolean[],        함선별 완성 여부
 *   results: { newCells, newHits, completedShips: number[], cost, bonus, penalty: number, usedOrange: boolean }[],
 *                                추측마다 새로 얻은 것 · 쓴 횟수 · 주황 칸을 지나갔는지('연속 주황 금지')
 *   used: number,                쓴 추측 수 (벌점·돌려받은 수 반영) — 한도와 비교하는 값
 *   status: 'playing'|'won'|'lost',
 * }}
 */
export function computeState(puzzle, guesses, { maxGuesses = MAX_GUESSES } = {}) {
  const geo = geoOf(puzzle);
  const map = shipMap(puzzle);
  const revealed = new Array(geo.cellCount).fill(null);
  const hit = new Array(geo.cellCount).fill(false);
  const miss = new Array(geo.cellCount).fill(false);
  const completed = puzzle.ships.map(() => false);
  const results = [];
  let used = 0;
  let status = 'playing';

  for (const g of guesses) {
    if (status !== 'playing') break;
    const cells = geo.boxCells(g);
    const chars = [...g.word];
    const newCells = [];
    const newHits = [];
    // 이번 추측 전부터 주황(명중·글자 미공개)이던 칸 — 힌트 후보 (GDD §4)
    const orangeBefore = cells.filter((idx) => hit[idx] && !revealed[idx]);
    cells.forEach((idx, i) => {
      const at = map[idx];
      if (!at) { miss[idx] = true; return; }
      if (!hit[idx]) { hit[idx] = true; newHits.push(idx); }
      if (revealed[idx]) return;
      const syl = puzzle.ships[at.ship].name[at.pos];
      if (chars[i] === syl) { revealed[idx] = syl; newCells.push(idx); }
    });
    // 힌트: 아직 가려진 주황 칸 중 박스에서 가장 앞 칸 하나만 공개
    const hint = orangeBefore.find((idx) => !revealed[idx]);
    if (hint !== undefined) {
      const at = map[hint];
      revealed[hint] = puzzle.ships[at.ship].name[at.pos];
      newCells.push(hint);
    }
    const completedShips = [];
    puzzle.ships.forEach((ship, s) => {
      if (completed[s] || g.word !== ship.name || !sameBox(g, ship)) return;
      completed[s] = true;
      completedShips.push(s);
    });
    const { cost, bonus, penalty } = guessCost(puzzle, g.len, completedShips.length > 0, results.length + 1);
    used += cost - bonus + penalty;
    results.push({ newCells, newHits, completedShips, cost, bonus, penalty, usedOrange: orangeBefore.length > 0 });
    if (completed.every(Boolean)) status = 'won';
    else if (used >= maxGuesses) status = 'lost';
  }
  return { revealed, hit, miss, completed, results, used, status };
}

/** 추측 하나의 칸별 결과 — 'miss'(빈 바다) | 'hit'(함선, 글자 틀림) | 'match'(글자까지 맞음). 기록 목록용 */
export function cellOutcomes(puzzle, guess, map = shipMap(puzzle)) {
  const chars = [...guess.word];
  return geoOf(puzzle).boxCells(guess).map((idx, i) => {
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
