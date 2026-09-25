/**
 * test-game.mjs — 규칙·생성기 단위 테스트 (의존성 없음).
 *
 *   npm test
 */
import { onsetOf, onsetsOf } from '../src/core/hangul.js';
import { boardOf } from '../src/game/board.js';
import { FLEET, MAX_GUESSES, computeState, validateGuess, resultEmoji, guessRules, parsePuzzle } from '../src/game/game.js';
import { generatePuzzle, countDecoys, DEFAULT_MIN_DECOYS } from '../src/game/generator.js';
import { GIMMICK_IDS, GIMMICK_PAIRS, dailyGimmicks, FOG_RATIO, fleetFor, holesFor, boardSizeFor } from '../src/game/gimmicks.js';
import { distBuckets, bucketIndexFor } from '../src/daily/storage.js';
import { loadAnswerPool, loadGuessDictionary } from './lib/words.mjs';
import { MODES } from '../src/game/modes.js';

const { boxCells, boxFromEndpoints, idxOf, allBoxes, boxLabel } = boardOf(8);

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
test('10×10 기하 — 칸 번호·박스 개수·표기·둘레', () => {
  const g10 = boardOf(10);
  eq(g10.boxCells({ r: 0, c: 0, dir: 'v', len: 3 }), [0, 10, 20]);
  eq(g10.boxCells({ r: 0, c: 8, dir: 'h', len: 3 }), null, '보드 밖');
  eq(g10.allBoxes(4).length, 70 + 70 + 49 + 49);
  eq(g10.boxLabel({ r: 9, c: 9, dir: 'h', len: 2 }), 'j10→');
  eq(g10.boxFromEndpoints(g10.idxOf(9, 0), g10.idxOf(6, 3)), { r: 9, c: 0, dir: 'u', len: 4 });
  eq(g10.neighbors(0).sort((a, b) => a - b), [1, 10, 11]);
  eq(boardOf(8).neighbors(idxOf(3, 3)).length, 8);
});

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
  eq(s.results[0], { newCells: [0, 2], newHits: [0, 1, 2], completedShips: [], cost: 1, bonus: 0, penalty: 0, usedOrange: false });
  eq(s.used, 1);
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

// ── 사자성어 모드 ──
const idiomPool = loadAnswerPool('idiom');
test('사자성어 풀 — 4글자만, 300개 이상, 전부 추측 사전에 있음', () => {
  eq(idiomPool.words[2].length + idiomPool.words[3].length, 0);
  ok(idiomPool.words[4].length >= 300, `${idiomPool.words[4].length}개`);
  for (const w of idiomPool.words[4]) ok(dict.has(w), `${w} 누락`);
});
test('사자성어 퍼즐 30개 — 4칸 5척, 함명 전부 사자성어, 같은 시드 같은 판', () => {
  const m = MODES.idiom;
  for (let i = 0; i < 30; i++) {
    const p = generatePuzzle(`idiom-t:${i}`, idiomPool, { fleet: m.fleet, minDecoys: m.minDecoys });
    eq(p.ships.map((s) => s.len), [4, 4, 4, 4, 4]);
    for (const s of p.ships) ok(idiomPool.words[4].includes(s.name), `${s.name} 사자성어 풀 밖`);
    ok(countDecoys(p, idiomPool)[4] >= m.minDecoys[4], '미끼 부족');
  }
  const opts = { fleet: m.fleet, minDecoys: m.minDecoys };
  eq(generatePuzzle('daily-idiom:2026-09-24', idiomPool, opts), generatePuzzle('daily-idiom:2026-09-24', idiomPool, opts));
});

// ── 익스텐디드 기믹 (GDD §10) ──
// 손으로 만든 판(P)에 기믹만 바꿔 끼운다
const withG = (gimmicks, extra = {}) => ({ ...P, size: 8, gimmicks, locked: [], holes: [], ...extra });

test('그날의 기믹 — 결정적 · 서로 다른 2개 · 167일에 167조합 전부 · 이틀 연속 같은 조합 없음 · 못 겹치는 짝 없음', () => {
  eq(GIMMICK_IDS.length, 19);
  const n = GIMMICK_PAIRS.length;
  eq(n, 171 - 4);
  eq(dailyGimmicks('2026-09-25'), dailyGimmicks('2026-09-25'));
  const days = Array.from({ length: n * 3 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 8, 23 + i)).toISOString().slice(0, 10);
    return dailyGimmicks(d);
  });
  for (const pair of days) {
    eq(pair.length, 2);
    ok(pair[0] !== pair[1], '같은 기믹 두 번');
    ok(pair.every((id) => GIMMICK_IDS.includes(id)), `모르는 기믹 ${pair}`);
    const sizes = pair.filter((id) => ['wide', 'narrow', 'donut'].includes(id));
    ok(sizes.length < 2 && !(pair.includes('noMiss') && pair.includes('gray3')), `못 겹치는 짝 ${pair}`);
  }
  for (let c = 0; c < 3; c++) {
    eq(new Set(days.slice(c * n, c * n + n).map((p) => p.join('+'))).size, n, `${c}번째 바퀴`);
  }
  for (let i = 1; i < days.length; i++) ok(days[i].join('+') !== days[i - 1].join('+'), `${i}일째 연속 같은 조합`);
});

test('잠긴 칸 — 아무 초성이나 받고, 한 번 추측에 포함되면 초성이 드러남', () => {
  const p = withG(['fog'], { locked: [0, 1] }); // 바다새의 '바'·'다' 칸
  const v = validateGuess(p, [], { r: 0, c: 0, dir: 'h', len: 3 }, '가나새', null);
  ok(v.ok, v.reason);
  ok(!validateGuess(p, [], { r: 0, c: 0, dir: 'h', len: 3 }, '가나다', null).ok, '잠기지 않은 3번째 칸은 초성 검사');
  const before = guessRules(p, []);
  eq([before.hidden[0], before.hidden[1], before.hidden[2]], [true, true, false]);
  const after = guessRules(p, [g(0, 0, 'd', '가아')]); // a1만 지나감
  eq([after.hidden[0], after.hidden[1]], [false, true], 'a1만 풀림');
  ok(!validateGuess(p, [g(0, 0, 'd', '가아')], { r: 0, c: 0, dir: 'h', len: 3 }, '가나새', null).ok, '풀린 칸은 다시 초성 검사');
});

test('길이 바꾸기 — 직전과 같은 길이는 거절(횟수 안 씀), 다른 길이는 통과', () => {
  const p = withG(['alternate']);
  const prev = [g(0, 0, 'h', '바람새')];
  const same = validateGuess(p, prev, { r: 3, c: 3, dir: 'h', len: 3 }, '아아아', null);
  ok(!same.ok && same.reason.includes('길이'), same.reason);
  ok(validateGuess(p, prev, { r: 3, c: 3, dir: 'h', len: 2 }, '아아', null).ok, '2글자');
  ok(validateGuess(p, [], { r: 3, c: 3, dir: 'h', len: 3 }, '아아아', null).ok, '첫 추측은 자유');
  eq(guessRules(p, prev).banLen, 3);
  eq(guessRules(P, prev).banLen, null, '기믹 없으면 제한 없음');
});

test('거리 두기 — 직전 추측 칸과 둘레 8칸(대각 포함)은 거절, 떨어진 칸은 통과', () => {
  const p = withG(['apart']);
  const prev = [g(3, 3, 'h', '아아')]; // d4·e4
  const r = guessRules(p, prev);
  eq(r.blocked.filter(Boolean).length, 12, '2칸 + 둘레 10칸');
  ok(!validateGuess(p, prev, { r: 3, c: 3, dir: 'h', len: 2 }, '아우', null).ok, '같은 칸');
  ok(!validateGuess(p, prev, { r: 5, c: 1, dir: 'u', len: 3 }, '아아아', null).ok, '대각으로 닿는 칸(c5)');
  ok(validateGuess(p, prev, { r: 3, c: 0, dir: 'v', len: 2 }, '아아', null).ok, '두 칸 떨어진 a열');
  ok(!guessRules(P, prev).blocked.some(Boolean), '기믹 없으면 제한 없음');
});

test('길이 3 선호 — 2·4글자 헛방은 2번, 3글자 헛방은 1번, 함선 완성은 +1 돌려받음, 벌점으로 한도를 넘기면 실패', () => {
  const p = withG(['costly']);
  const s = computeState(p, [g(0, 0, 'h', '바람새'), g(2, 0, 'h', '아아'), g(0, 7, 'v', '고속도로'), g(4, 0, 'h', '아아아아')], { maxGuesses: 40 });
  eq(s.results.map((r) => [r.cost, r.bonus]), [[1, 0], [2, 0], [1, 1], [2, 0]]);
  eq(s.used, 5);
  // 3글자 완성도 +1
  eq(computeState(p, [g(0, 0, 'h', '바다새')]).used, 0);
  // 기믹 없으면 완성해도 보상 없음
  eq(computeState(P, [g(0, 0, 'h', '바다새')]).used, 1);
  // 39번 쓴 뒤 2글자 헛방 → 41 ≥ 40 → 실패
  const junk = Array.from({ length: 39 }, (_, i) => g(2 + (i % 5), 0, 'h', '아아아'));
  const lost = computeState(p, [...junk, g(7, 0, 'h', '아아')], { maxGuesses: 40 });
  eq(lost.status, 'lost');
  eq(lost.used, 41);
  // 기믹 없으면 늘 1번
  eq(computeState(P, [g(2, 0, 'h', '아아')]).results[0].cost, 1);
});

test('회색 칸 금지 — 빈 바다로 확인된 칸을 지나는 박스는 거절', () => {
  const p = withG(['noMiss']);
  const prev = [g(1, 0, 'h', '아아')]; // a2·b2 빈 바다
  const v = validateGuess(p, prev, { r: 0, c: 0, dir: 'v', len: 2 }, '바아', null);
  ok(!v.ok && v.reason.includes('회색 칸 금지'), v.reason);
  ok(validateGuess(p, prev, { r: 0, c: 0, dir: 'h', len: 3 }, '바다새', null).ok, '회색 없는 박스');
  eq(guessRules(p, prev).blocked.filter(Boolean).length, 2);
});

test('회색 칸 필수 — 3·6·9번째 추측은 회색 칸 포함 (회색이 없으면 면제)', () => {
  const p = withG(['gray3']);
  const two = [g(1, 0, 'h', '아아'), g(0, 0, 'h', '바람새')]; // a2·b2 빈 바다
  const r = guessRules(p, two);
  eq(r.mustGray, true);
  const v = validateGuess(p, two, { r: 4, c: 4, dir: 'h', len: 2 }, '아아', null);
  ok(!v.ok && v.reason.includes('회색 칸 필수'), v.reason);
  ok(validateGuess(p, two, { r: 1, c: 1, dir: 'h', len: 2 }, '아아', null).ok, 'b2(회색) 포함');
  eq(guessRules(p, two.slice(0, 1)).mustGray, false, '2번째는 자유');
  eq(guessRules(p, [g(0, 0, 'h', '바람새'), g(0, 7, 'v', '고속도로')]).mustGray, false, '회색이 아직 없으면 면제');
});

test('연속 주황 금지 — 주황 칸을 지난 추측 다음엔 주황 칸을 못 씀', () => {
  const p = withG(['noOrange']);
  const pre = [g(0, 0, 'h', '보도스')]; // a1·b1·c1 주황 (이 추측 자체는 주황을 '지나간' 게 아님)
  eq(guessRules(p, pre).blocked.filter(Boolean).length, 0, '처음 주황이 된 추측 다음은 자유');
  const twice = [...pre, g(0, 0, 'v', '보아')]; // a1(주황)을 지나감 → 힌트로 a1 공개
  const r = guessRules(p, twice);
  ok(r.blocked[1] && r.blocked[2] && !r.blocked[0], 'b1·c1(아직 주황) 금지, a1(노랑)은 자유');
  const v = validateGuess(p, twice, { r: 0, c: 1, dir: 'v', len: 2 }, '도아', null);
  ok(!v.ok && v.reason.includes('연속 주황'), v.reason);
  ok(validateGuess(p, [...twice, g(5, 0, 'h', '아아')], { r: 0, c: 1, dir: 'v', len: 2 }, '도아', null).ok, '한 번 쉬면 다시 가능');
  eq(computeState(p, twice).results.map((x) => x.usedOrange), [false, true]);
});

test('관문 — 10·20번째 추측에 함선을 완성하지 못하면 −5', () => {
  const p = withG(['checkpoint']);
  const junk = (n) => Array.from({ length: n }, (_, i) => g(2 + (i % 5), 0, 'h', '아아아'));
  const s = computeState(p, junk(10), { maxGuesses: 40 });
  eq(s.results[9].penalty, 5);
  eq(s.used, 15);
  const ok10 = computeState(p, [...junk(9), g(0, 0, 'h', '바다새')], { maxGuesses: 40 });
  eq([ok10.results[9].penalty, ok10.used], [0, 10], '10번째에 완성하면 벌점 없음');
  eq(computeState(p, junk(9), { maxGuesses: 40 }).used, 9, '9번째까지는 벌점 없음');
  eq(computeState(p, junk(20), { maxGuesses: 99 }).used, 30, '두 관문 모두 실패');
  eq(computeState(p, junk(30), { maxGuesses: 99 }).results[29].penalty, 0, '30번째는 관문 아님');
});

test('보급 부족 — 시작부터 3번 쓴 상태 (추측 없어도)', () => {
  const p = withG(['lowStart']);
  eq(computeState(p, []).used, 3);
  eq(computeState(p, [g(2, 0, 'h', '아아')]).used, 4);
  const lost = computeState(p, [g(2, 0, 'h', '아아'), g(3, 0, 'h', '아아')], { maxGuesses: 5 });
  eq([lost.status, lost.results.length], ['lost', 2], '한도 5면 2번 만에 실패');
  eq(computeState(P, []).used, 0, '기믹 없으면 0');
});

test('판 크기 기믹 — 7×7 · 10×10 · 12×12 도넛(가운데 4×4 구멍)', () => {
  eq([boardSizeFor([]), boardSizeFor(['narrow']), boardSizeFor(['fog', 'wide']), boardSizeFor(['donut'])], [8, 7, 10, 12]);
  const holes = holesFor(['donut']);
  eq(holes.length, 16);
  const g12 = boardOf(12);
  ok(holes.every((i) => [4, 5, 6, 7].includes(g12.rowOf(i)) && [4, 5, 6, 7].includes(g12.colOf(i))), '가운데 4×4');
  const p = withG(['donut'], { size: 12, holes, onsets: new Array(144).fill('ㅇ'), ships: [] });
  const v = validateGuess(p, [], { r: 3, c: 3, dir: 'd', len: 3 }, '아아아', null);
  ok(!v.ok && v.reason.includes('구멍'), v.reason);
  ok(validateGuess(p, [], { r: 0, c: 0, dir: 'h', len: 4 }, '아아아아', null).ok, '테두리 쪽은 가능');
});

test('제약이 겹쳐 둘 곳이 없으면 그 한 번은 풀림', () => {
  // a1·b1 두 칸만 남은 판에서 길이 바꾸기 — 직전 2글자라 2칸 박스가 막히면 둘 곳이 없다
  const holes = [...Array(64).keys()].filter((i) => i > 1);
  const p = withG(['alternate'], { holes });
  const prev = [g(0, 0, 'h', '바다')];
  const r = guessRules(p, prev);
  eq([r.relaxed, r.banLen], [true, null]);
  ok(validateGuess(p, prev, { r: 0, c: 0, dir: 'h', len: 2 }, '바도', null).ok, '풀린 뒤 통과');
  eq(guessRules(withG(['alternate']), prev).relaxed, false, '보통은 안 풀림');
});

test('방향 바꾸기 — 직전과 같은 방향은 거절, 다른 방향은 통과', () => {
  const p = withG(['turn']);
  const prev = [g(0, 0, 'h', '바람새')];
  const same = validateGuess(p, prev, { r: 4, c: 0, dir: 'h', len: 2 }, '아아', null);
  ok(!same.ok && same.reason.includes('방향'), same.reason);
  ok(validateGuess(p, prev, { r: 4, c: 0, dir: 'v', len: 2 }, '아아', null).ok, '세로');
  eq(guessRules(p, prev).banDir, 'h');
});

test('첫 칸 십자 · 끝 칸 십자 — 직전 첫/끝 칸의 가로줄·세로줄 전체 금지', () => {
  const prev = [g(2, 2, 'd', '아아아')]; // c3 → e5
  const start = guessRules(withG(['lineStart']), prev);
  eq(start.blocked.filter(Boolean).length, 15, '3행 + c열');
  ok(start.blocked[idxOf(2, 7)] && start.blocked[idxOf(7, 2)], 'h3 · c8');
  ok(!start.blocked[idxOf(4, 4)], '끝 칸(e5)은 자유');
  ok(!validateGuess(withG(['lineStart']), prev, { r: 2, c: 6, dir: 'h', len: 2 }, '아아', null).ok, '3행 끝의 g3');
  ok(validateGuess(withG(['lineStart']), prev, { r: 5, c: 5, dir: 'h', len: 2 }, '아아', null).ok, '떨어진 f6');
  const end = guessRules(withG(['lineEnd']), prev);
  ok(end.blocked[idxOf(4, 0)] && end.blocked[idxOf(0, 4)] && !end.blocked[idxOf(2, 2)], '5행 · e열만');
  const both = guessRules(withG(['lineStart', 'lineEnd']), prev);
  eq(both.blocked.filter(Boolean).length, 15 + 15 - 2, '두 십자 합집합');
  const v = validateGuess(withG(['lineEnd']), prev, { r: 0, c: 4, dir: 'v', len: 2 }, '아아', null);
  ok(!v.ok && v.reason.includes('끝 칸 십자'), v.reason);
});

test('증원 — 기본 함대에 함선 추가 (긴 것부터)', () => {
  eq(fleetFor(FLEET, ['extra4']), [4, 4, 3, 3, 3, 2, 2]);
  eq(fleetFor(FLEET, ['extra3', 'extra2']), [4, 3, 3, 3, 3, 2, 2, 2]);
  eq(fleetFor(FLEET, ['wide', 'fog']), FLEET);
});

test('데일리 파일 → 퍼즐 (예전 파일은 8×8 · 기믹 없음)', () => {
  const old = parsePuzzle({ onsets: 'ㅇ'.repeat(64), ships: [] });
  eq([old.size, old.gimmicks, old.locked, old.holes, old.onsets.length], [8, [], [], [], 64]);
  const ext = parsePuzzle({ size: 10, gimmicks: ['wide', 'fog'], locked: [3], onsets: 'ㅇ'.repeat(100), ships: [] });
  eq([ext.size, ext.gimmicks, ext.locked, ext.onsets.length], [10, ['wide', 'fog'], [3], 100]);
});

test('익스텐디드 퍼즐 — 167조합 × 1판: 판 크기 · 구멍 · 잠긴 칸 · 함대 · 미끼 · 함명 추측 통과', () => {
  const m = MODES.extended;
  const base = boardOf(8);
  for (const gimmicks of GIMMICK_PAIRS) {
    const p = generatePuzzle(`ext-t:${gimmicks}`, pool, { fleet: m.fleet, minDecoys: m.minDecoys, gimmicks });
    const geo = boardOf(p.size);
    eq(p.size, boardSizeFor(gimmicks), '판 크기');
    eq(p.onsets.length, geo.cellCount);
    eq(p.gimmicks, gimmicks);
    eq(p.holes, holesFor(gimmicks), '구멍');
    eq(p.ships.map((s) => s.len), fleetFor(FLEET, gimmicks));
    const holeSet = new Set(p.holes);
    ok(p.ships.every((s) => geo.boxCells(s).every((idx) => !holeSet.has(idx))), '함선이 구멍 위');
    ok(p.locked.every((idx) => !holeSet.has(idx)), '구멍이 잠긴 칸');
    const diag = new Set();
    for (let r = 0; r < p.size; r++) { diag.add(geo.idxOf(r, r)); diag.add(geo.idxOf(r, p.size - 1 - r)); }
    holeSet.forEach((idx) => diag.delete(idx)); // 구멍은 잠그지 않는다
    const fogN = gimmicks.includes('fog') ? Math.round((geo.cellCount - holeSet.size) * FOG_RATIO) : 0;
    eq(p.locked.length, (gimmicks.includes('cross') ? diag.size : 0) + fogN, `${gimmicks} 잠긴 칸 수`);
    if (gimmicks.includes('cross')) ok([...diag].every((idx) => p.locked.includes(idx)), '대각선 전부 잠김');
    ok(new Set(p.locked).size === p.locked.length && p.locked.every((idx) => idx >= 0 && idx < geo.cellCount), '잠긴 칸 번호');
    // 미끼 — 8×8 기준을 (구멍 안 지나는) 박스 수에 비례해서
    const d = countDecoys(p, pool);
    for (const len of [2, 3, 4]) {
      const here = geo.allBoxes(len).filter((b) => geo.boxCells(b).every((i) => !holeSet.has(i))).length;
      const want = Math.floor((m.minDecoys[len] * here) / base.allBoxes(len).length);
      ok(d[len] >= want, `${gimmicks} ${len}칸 미끼 ${d[len]} < ${want}`);
    }
    for (const s of p.ships) {
      ok(geo.boxCells(s), '보드 밖 함선');
      const v = validateGuess(p, [], s, s.name, dict);
      ok(v.ok, `${s.name}: ${v.reason}`);
    }
  }
  const opts = { fleet: m.fleet, minDecoys: m.minDecoys, gimmicks: ['donut', 'fog'] };
  eq(generatePuzzle('daily-extended:2026-09-25', pool, opts), generatePuzzle('daily-extended:2026-09-25', pool, opts));
});

test('기믹 없는 모드의 생성 결과는 예전과 같음 (잠금 추첨이 난수를 쓰지 않음)', () => {
  const p = generatePuzzle('daily:2026-09-24', pool);
  eq([p.size, p.gimmicks, p.locked, p.holes], [8, [], [], []]);
});

test('통계 분포 구간 — 스탠다드 5번씩 · 익스텐디드 첫 구간 1~10 · 한도 35', () => {
  eq(MODES.extended.maxGuesses, 35);
  eq(distBuckets('standard'), ['1~5번', '6~10번', '11~15번', '16~20번', '21~25번', '26~30번', '실패']);
  eq(distBuckets('extended'), ['1~10번', '11~15번', '16~20번', '21~25번', '26~30번', '31~35번', '실패']);
  eq(bucketIndexFor('solved', 7, 'standard'), 1);
  eq(bucketIndexFor('solved', 7, 'extended'), 0);
  eq(bucketIndexFor('solved', 36, 'extended'), 5);
  eq(bucketIndexFor('solved', 41, 'extended'), 5, '한도 넘어도 마지막 성공 구간');
  eq(bucketIndexFor('failed', null, 'extended'), 6);
});

console.log(`${pass}/${pass + fail} 통과`);
if (fail) process.exitCode = 1;
