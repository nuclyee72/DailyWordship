/**
 * test-game.mjs — 규칙·생성기 단위 테스트 (의존성 없음).
 *
 *   npm test
 */
import { onsetOf, onsetsOf } from '../src/core/hangul.js';
import { boxCells, boxFromEndpoints, idxOf, allBoxes, boxLabel } from '../src/game/board.js';
import { FLEET, MAX_GUESSES, computeState, validateGuess, resultEmoji } from '../src/game/game.js';
import { generatePuzzle, countDecoys, DEFAULT_MIN_DECOYS } from '../src/game/generator.js';
import { loadAnswerPool, loadGuessDictionary } from './lib/words.mjs';

let pass = 0;
let fail = 0;
function test(name, fn) {
  try { fn(); pass++; } catch (err) { fail++; console.log(`❌ ${name}\n   ${err.message}`); }
}
function eq(actual, expected, msg = '') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg} 기대 ${e} · 실제 ${a}`);
}
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };

// ── 한글 ──
test('초성 추출', () => {
  eq(onsetOf('다'), 'ㄷ');
  eq(onsetOf('까'), 'ㄲ');
  eq(onsetOf('a'), null);
  eq(onsetsOf('다슬기'), 'ㄷㅅㄱ');
});

// ── 보드 기하 ──
test('박스 4방향 칸', () => {
  eq(boxCells({ r: 0, c: 0, dir: 'h', len: 3 }), [0, 1, 2]);
  eq(boxCells({ r: 0, c: 0, dir: 'v', len: 3 }), [0, 8, 16]);
  eq(boxCells({ r: 0, c: 0, dir: 'd', len: 3 }), [0, 9, 18]);
  eq(boxCells({ r: 7, c: 0, dir: 'u', len: 3 }), [56, 49, 42]);
  eq(boxCells({ r: 0, c: 6, dir: 'h', len: 3 }), null, '보드 밖');
  eq(boxCells({ r: 1, c: 0, dir: 'u', len: 3 }), null, '보드 밖');
});
test('드래그 → 박스 (거꾸로 끌어도 고정 읽기 방향)', () => {
  eq(boxFromEndpoints(idxOf(2, 5), idxOf(2, 3)), { r: 2, c: 3, dir: 'h', len: 3 });
  eq(boxFromEndpoints(idxOf(5, 1), idxOf(2, 1)), { r: 2, c: 1, dir: 'v', len: 4 });
  eq(boxFromEndpoints(idxOf(3, 3), idxOf(1, 1)), { r: 1, c: 1, dir: 'd', len: 3 });
  eq(boxFromEndpoints(idxOf(1, 4), idxOf(3, 2)), { r: 3, c: 2, dir: 'u', len: 3 });
  eq(boxFromEndpoints(idxOf(0, 0), idxOf(1, 2)), null, '직선 아님');
  eq(boxFromEndpoints(idxOf(0, 0), idxOf(0, 0)), null, '1칸');
  eq(boxFromEndpoints(idxOf(0, 0), idxOf(0, 4)), null, '5칸');
});
test('박스 개수', () => {
  eq(allBoxes(2).length, 56 + 56 + 49 + 49);
  eq(allBoxes(4).length, 40 + 40 + 25 + 25);
});
test('박스 표기', () => eq(boxLabel({ r: 2, c: 1, dir: 'd', len: 3 }), 'b3↘'));

// ── 규칙 — 손으로 만든 퍼즐 ──
// 행0: 바다새 (가로, a1~c1)   열7: 고속도로 (세로, h1~h4)
const onsets = new Array(64).fill('ㅇ');
const P = {
  onsets,
  ships: [
    { len: 3, r: 0, c: 0, dir: 'h', name: '바다새' },
    { len: 4, r: 0, c: 7, dir: 'v', name: '고속도로' },
  ],
};
['ㅂ', 'ㄷ', 'ㅅ'].forEach((o, i) => { onsets[i] = o; });
['ㄱ', 'ㅅ', 'ㄷ', 'ㄹ'].forEach((o, i) => { onsets[7 + i * 8] = o; });
onsets[3] = 'ㄲ';
const DICT = { has: (w) => ['바다새', '바람새', '보도블', '고속도로', '바다', '다시'].includes(w) };
const g = (r, c, dir, word) => ({ r, c, dir, len: [...word].length, word });

test('검사 — 초성 불일치 / 경음 대체 불가', () => {
  const v = validateGuess(P, [], { r: 0, c: 0, dir: 'h', len: 3 }, '가다새', DICT);
  ok(!v.ok && v.reason.includes('1번째'), v.reason);
  const hard = validateGuess(P, [], { r: 0, c: 3, dir: 'h', len: 2 }, '가아', null);
  ok(!hard.ok, 'ㄲ 칸에 ㄱ 허용됨');
});
test('검사 — 길이·사전·중복', () => {
  ok(!validateGuess(P, [], { r: 0, c: 0, dir: 'h', len: 3 }, '바다', DICT).ok, '길이');
  ok(!validateGuess(P, [], { r: 0, c: 0, dir: 'h', len: 3 }, '보도스', DICT).ok, '사전');
  ok(validateGuess(P, [], { r: 0, c: 0, dir: 'h', len: 3 }, ' 바다새 ', DICT).ok, '공백 무시');
  ok(!validateGuess(P, [g(0, 0, 'h', '바다새')], { r: 0, c: 0, dir: 'h', len: 3 }, '바다새', DICT).ok, '중복');
  ok(!validateGuess(P, [], { r: 0, c: 0, dir: 'h', len: 5 }, '바다새', DICT).ok, '5칸');
});
test('칸별 판정 — 명중·음절·빈칸', () => {
  const s = computeState(P, [g(0, 0, 'h', '바람새')]);
  eq(s.revealed.slice(0, 3), ['바', null, '새']);
  eq(s.hit.slice(0, 3), [true, true, true]);
  eq(s.results[0], { newCells: [0, 2], newHits: [0, 1, 2], completedShips: [] });
  const s2 = computeState(P, [g(1, 0, 'h', '아아아')]);
  eq(s2.miss.slice(8, 11), [true, true, true]);
  eq(resultEmoji(s2.results[0]), '⬜');
});
test('누적 완성 → 초록 · 승리', () => {
  const s = computeState(P, [g(0, 0, 'h', '바람새'), g(0, 0, 'h', '바다새')]);
  eq(s.completed, [true, false]);
  eq(resultEmoji(s.results[0]), '🟨');
  eq(resultEmoji(s.results[1]), '🟩');
  const w = computeState(P, [g(0, 0, 'h', '바다새'), g(0, 7, 'v', '고속도로')]);
  eq(w.status, 'won');
});
test('주황 칸을 지나는 추측 → 틀려도 그 칸 글자만 노랑 힌트 (박스 밖은 안 열림)', () => {
  // 1) 바다새의 '다' 칸(b1)만 대각선으로 명중 (글자 틀림) → 주황
  const s1 = computeState(P, [g(0, 1, 'd', '도아')]);
  eq(s1.hit[1], true);
  eq(s1.revealed[1], null);
  // 2) 그 주황 칸(b1)을 지나는 세로 2칸 추측 — 틀려도 b1 글자만 공개, a1·c1은 그대로
  const s2 = computeState(P, [g(0, 1, 'd', '도아'), g(0, 1, 'v', '도오')]);
  eq(s2.revealed.slice(0, 3), [null, '다', null]);
  eq(s2.completed, [false, false], '힌트로는 초록이 안 됨');
  eq(resultEmoji(s2.results[1]), '🟨');
  // 처음 명중한 추측 자체에서는 힌트가 없다
  const s3 = computeState(P, [g(0, 0, 'h', '보도스')]);
  eq(s3.revealed.slice(0, 3), [null, null, null]);
});
test('주황 칸이 여럿이면 박스에서 가장 앞 칸 하나만 힌트', () => {
  const pre = [g(0, 0, 'h', '보도스')]; // a1·b1·c1 모두 주황
  const s = computeState(P, [...pre, g(0, 0, 'h', '부두소')]);
  eq(s.revealed.slice(0, 3), ['바', null, null], '1번 칸만');
  // 앞 칸을 이번 추측이 직접 맞히면, 힌트는 그다음 가려진 주황 칸으로
  const s2 = computeState(P, [...pre, g(0, 0, 'h', '바도스')]);
  eq(s2.revealed.slice(0, 3), ['바', '다', null]);
});
test('글자가 전부 노랑이어도 이름을 입력해야 초록', () => {
  const partial = [g(0, 0, 'h', '바람새'), g(0, 0, 'h', '보다스')]; // 바·새 → 다 : 전부 공개
  const s = computeState(P, partial);
  eq(s.revealed.slice(0, 3), ['바', '다', '새']);
  eq(s.completed, [false, false]);
  const s2 = computeState(P, [...partial, g(0, 0, 'h', '바다새')]);
  eq(s2.completed, [true, false]);
  // 이름이 같아도 자리가 다르면 완성 아님
  const s3 = computeState(P, [g(1, 0, 'h', '바다새')]);
  eq(s3.completed, [false, false]);
});
test('대각 박스로 함선 일부 명중', () => {
  const s = computeState(P, [g(0, 1, 'd', '다아')]);
  eq(s.revealed[1], '다');
  eq(s.miss[10], true);
  eq(resultEmoji(s.results[0]), '🟨');
});
test('한도 소진 → 실패, 이후 추측 무시', () => {
  const junk = Array.from({ length: MAX_GUESSES + 3 }, (_, i) => g(2 + (i % 5), 0, 'h', '아아'));
  const s = computeState(P, junk);
  eq(s.status, 'lost');
  eq(s.results.length, MAX_GUESSES);
});
test('같은 입력 → 같은 상태 (재계산 결정성)', () => {
  const gs = [g(0, 0, 'h', '바람새'), g(3, 3, 'd', '아아아')];
  eq(computeState(P, gs), computeState(P, gs));
});

// ── 생성기 ──
const pool = loadAnswerPool();
const dict = loadGuessDictionary();
test('추측 사전 — 일상 합성어·외래어 허용, 아무 음절 조합은 거절', () => {
  for (const w of ['징검다리', '불꽃놀이', '신용카드', '모래사장', '라면집', '택시비', '김치통', '운동화끈', '교통카드']) ok(dict.has(w), `${w} 거절됨`);
  for (const w of ['바라다', '다라가나', '쿠쿠쿠', '뷁뷁', '혀뀨']) ok(!dict.has(w), `${w} 허용됨`);
});
test('출제 풀은 전부 추측 사전에 있음', () => {
  for (const len of [2, 3, 4]) for (const w of pool.words[len]) ok(dict.has(w), `${w} 누락`);
});
test('같은 시드 → 같은 퍼즐', () => eq(generatePuzzle('daily:2026-09-24', pool), generatePuzzle('daily:2026-09-24', pool)));
test('다른 시드 → 다른 퍼즐', () => ok(JSON.stringify(generatePuzzle('a', pool)) !== JSON.stringify(generatePuzzle('b', pool)), '같음'));
test('생성 퍼즐 50개 — 함대·겹침·초성·함명·미끼', () => {
  for (let i = 0; i < 50; i++) {
    const p = generatePuzzle(`t:${i}`, pool);
    eq(p.ships.map((s) => s.len), FLEET);
    const seen = new Set();
    for (const s of p.ships) {
      ok(pool.words[s.len].includes(s.name), `${s.name} 출제 풀 밖`);
      const cells = boxCells(s);
      ok(cells, '보드 밖 함선');
      cells.forEach((idx, k) => {
        ok(!seen.has(idx), '함선 겹침');
        seen.add(idx);
        eq(p.onsets[idx], onsetsOf(s.name)[k], '초성');
      });
    }
    eq(new Set(p.ships.map((s) => s.name)).size, p.ships.length, '함명 중복');
    const d = countDecoys(p, pool);
    for (const len of [2, 3, 4]) ok(d[len] >= DEFAULT_MIN_DECOYS[len], `${len}칸 미끼 ${d[len]}`);
    ok(p.onsets.every((o) => o && o.length === 1), '빈 초성');
  }
});
test('생성 퍼즐의 함명은 그대로 추측하면 전부 통과', () => {
  const p = generatePuzzle('solve', pool);
  const guesses = [];
  for (const s of p.ships) {
    const v = validateGuess(p, guesses, s, s.name, dict);
    ok(v.ok, `${s.name}: ${v.reason}`);
    guesses.push({ ...s, word: s.name });
  }
  eq(computeState(p, guesses).status, 'won');
});

console.log(`${pass}/${pass + fail} 통과`);
if (fail) process.exitCode = 1;
