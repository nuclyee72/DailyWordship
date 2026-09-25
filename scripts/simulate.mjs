/**
 * simulate.mjs — 밸런스 측정용 봇 대국. 추측 한도(MAX_GUESSES)와 생성기 품질 기준을 정할 때 쓴다.
 *
 *   node scripts/simulate.mjs [판 수=200] [모드=standard|extended|idiom] [시드 접두사=sim] [기믹=costly+wide]
 *
 * 익스텐디드는 기믹을 안 주면 모든 조합(GIMMICK_PAIRS)을 돌려 조합별로 한 줄씩 찍는다.
 * 측정 기록은 docs/GDD.md §5.3 · §9 · §10.
 *
 * 봇은 사람을 흉내 낸다 — 출제 풀 단어를 알고, 보드에서 그 초성열이 보이는 박스를 찾아 추측한다.
 *  1) 함선 칸으로 확인됐지만 아직 완성 안 된 칸이 있으면: 그 칸을 지나는 박스를 알려진 음절에 맞는 단어로 메우기
 *  2) 없으면: 아직 안 해 본 '그럴듯한 박스'(출제어 초성열과 맞는 박스)를 긴 것부터 하나 골라 찍기
 * 화면에 보이는 사실(명중·빈칸·공개 음절)과 기록에서 알 수 있는 사실(이 칸은 이 음절이 아니다)로 후보를 거른다.
 * 기믹 — 규칙이 막는 박스는 고르지 않고(boxProblem), 잠긴 칸은 아무 초성이나 맞는 것으로 본다.
 *   막히면 아무 자리에나 버리는 추측을 한다. '길이 3 선호'·'관문' 벌점은 그냥 치른다(피해 가려고 하지 않음).
 * 한도 없이 끝까지 두게 해서, 몇 번(벌점 포함) 만에 풀었는지 분포를 본다.
 */
import { loadAnswerPool } from './lib/words.mjs';
import { generatePuzzle } from '../src/game/generator.js';
import { computeState, shipMap, guessRules, boxProblem } from '../src/game/game.js';
import { modeOf } from '../src/game/modes.js';
import { geoOf } from '../src/game/board.js';
import { GIMMICK_IDS, GIMMICK_PAIRS } from '../src/game/gimmicks.js';
import { onsetsOf } from '../src/core/hangul.js';

const GAMES = Number(process.argv[2]) || 200;
const MODE = modeOf(process.argv[3] || 'standard');
const PREFIX = process.argv[4] || 'sim';
const GIMMICK_ARG = process.argv[5];
const MAX_GUESSES = MODE.maxGuesses;
const HARD_CAP = 120;

const pool = loadAnswerPool(MODE.id);
const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];

// 잠긴 칸용 — 초성열 일부를 '?'로 가린 모양 → 단어들 ('ㅂ?ㅅ' → 바다새, 보도스…)
const masked = new Map();
for (const len of [2, 3, 4]) {
  for (const w of pool.words[len]) {
    const on = [...onsetsOf(w)];
    for (let mask = 0; mask < 1 << len; mask++) {
      const key = on.map((o, k) => (mask & (1 << k) ? '?' : o)).join('');
      if (!masked.has(key)) masked.set(key, []);
      masked.get(key).push(w);
    }
  }
}

const boxesCache = new Map();
function boxesOf(geo) {
  if (!boxesCache.has(geo.size)) {
    boxesCache.set(geo.size, [4, 3, 2].flatMap((len) => geo.allBoxes(len).map((box) => ({
      ...box, cells: geo.boxCells(box), key: `${box.r},${box.c},${box.dir},${len}`,
    }))));
  }
  return boxesCache.get(geo.size);
}

function playBot(puzzle) {
  const geo = geoOf(puzzle);
  const BOXES = boxesOf(geo);
  const map = shipMap(puzzle);
  const guesses = [];
  const tried = new Set();
  const triedBox = new Set();
  const notSyl = Array.from({ length: geo.cellCount }, () => new Set());
  let state = computeState(puzzle, guesses, { maxGuesses: Infinity });
  let rules = guessRules(puzzle, guesses);
  let atCap = null;

  const patternOf = (b) => b.cells.map((i) => (rules.hidden[i] ? '?' : puzzle.onsets[i])).join('');
  const matching = (b) => masked.get(patternOf(b)) ?? [];
  const doneCell = (i) => map[i] && state.completed[map[i].ship];
  const isOpen = (i) => state.hit[i] && !doneCell(i);
  const fits = (b, w) => !tried.has(`${b.key}|${w}`)
    && b.cells.every((i, k) => (state.revealed[i] ? state.revealed[i] === w[k] : !notSyl[i].has(w[k])));
  const usable = (b) => !b.cells.some((i) => doneCell(i) || state.miss[i]) && !boxProblem(puzzle, guesses, b, rules);

  while (state.status !== 'won' && state.used < HARD_CAP) {
    let choice = null;
    const open = [];
    for (const b of BOXES) {
      const hits = b.cells.filter(isOpen).length;
      if (!hits || !usable(b)) continue;
      const words = matching(b).filter((w) => fits(b, w));
      if (words.length) open.push({ b, words, score: hits * 10 + b.len });
    }
    if (open.length) {
      const best = Math.max(...open.map((o) => o.score));
      const o = rand(open.filter((x) => x.score === best));
      choice = { b: o.b, w: rand(o.words) };
    } else {
      for (const fresh of [true, false]) {
        for (const len of [4, 3, 2]) {
          const cands = BOXES.filter((b) => b.len === len && (!fresh || !triedBox.has(b.key)) && usable(b))
            .map((b) => ({ b, words: matching(b).filter((w) => fits(b, w)) }))
            .filter((x) => x.words.length);
          if (cands.length) { const x = rand(cands); choice = { b: x.b, w: rand(x.words) }; break; }
        }
        if (choice) break;
      }
    }
    if (!choice) {
      // 기믹 때문에 쓸 만한 자리가 막혔으면(길이 바꾸기·거리 두기) 아무 자리에나 한 번 버리는 추측 — 사람도 이렇게 한다
      const filler = BOXES.filter((b) => !boxProblem(puzzle, guesses, b, rules))
        .map((b) => ({ b, words: matching(b).filter((w) => !tried.has(`${b.key}|${w}`)) }))
        .filter((x) => x.words.length);
      if (filler.length) { const x = rand(filler); choice = { b: x.b, w: rand(x.words) }; }
    }
    if (!choice) break;
    const { b, w } = choice;
    tried.add(`${b.key}|${w}`);
    triedBox.add(b.key);
    guesses.push({ r: b.r, c: b.c, dir: b.dir, len: b.len, word: w });
    const usedBefore = state.used;
    state = computeState(puzzle, guesses, { maxGuesses: Infinity });
    rules = guessRules(puzzle, guesses);
    b.cells.forEach((i, k) => {
      if (!state.revealed[i]) notSyl[i].add(w[k]);
    });
    if (usedBefore < MAX_GUESSES && state.used >= MAX_GUESSES) atCap = state.completed.filter(Boolean).length;
  }
  return { solvedAt: state.status === 'won' ? state.used : null, atCap: atCap ?? state.completed.filter(Boolean).length };
}

function run(gimmicks) {
  const solved = [];
  const atCap = [];
  const t0 = Date.now();
  for (let i = 0; i < GAMES; i++) {
    const puzzle = generatePuzzle(`${PREFIX}:${gimmicks.join('+')}:${i}`, pool, { fleet: MODE.fleet, minDecoys: MODE.minDecoys, gimmicks });
    const r = playBot(puzzle);
    if (r.solvedAt) solved.push(r.solvedAt);
    atCap.push(r.atCap);
  }
  solved.sort((a, b) => a - b);
  const q = (p) => solved[Math.min(solved.length - 1, Math.floor(solved.length * p))];
  const within = (cap) => Math.round((solved.filter((n) => n <= cap).length / GAMES) * 100);
  return { solved, atCap, q, within, secs: (Date.now() - t0) / 1000 };
}

if (MODE.gimmicks) {
  const pairs = GIMMICK_ARG
    ? [GIMMICK_ARG.split('+')]
    : GIMMICK_PAIRS;
  console.log(`[${MODE.label}] 조합마다 ${GAMES}판 · 한도 ${MAX_GUESSES} (추측 수는 벌점 포함)`);
  const caps = [30, MAX_GUESSES, MAX_GUESSES + 10];
  console.log(`조합                  중앙  75%  최대  | ${caps.map((c) => `${c}회`.padStart(5)).join(' ')}`);
  const rows = [];
  for (const pair of pairs) {
    const r = run(pair);
    rows.push({ pair, median: r.q(0.5), inCap: r.within(MAX_GUESSES) });
    const cell = (v) => String(v ?? '-').padStart(4);
    console.log(`${pair.join('+').padEnd(20)} ${cell(r.q(0.5))} ${cell(r.q(0.75))} ${cell(r.solved[r.solved.length - 1])}  | ${caps.map((c) => `${r.within(c)}%`.padStart(5)).join(' ')}`);
  }
  if (rows.length > 1) {
    // 기믹별 요약 — 그 기믹이 들어간 조합들의 평균
    console.log('\n기믹별 (들어간 조합 평균)  중앙  한도 안  | 가장 어려운 짝');
    const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
    for (const id of GIMMICK_IDS) {
      const mine = rows.filter((x) => x.pair.includes(id));
      if (!mine.length) continue;
      const worst = mine.reduce((a, b) => (b.inCap < a.inCap ? b : a));
      console.log(`${id.padEnd(22)} ${avg(mine.map((x) => x.median ?? HARD_CAP)).toFixed(1).padStart(5)}  ${`${avg(mine.map((x) => x.inCap)).toFixed(0)}%`.padStart(6)}   | ${worst.pair.join('+')} ${worst.inCap}%`);
    }
  }
} else {
  const r = run([]);
  const pct = (n) => `${((n / GAMES) * 100).toFixed(0)}%`;
  console.log(`[${MODE.label}] ${GAMES}판 · ${r.secs.toFixed(1)}초 · 풀이 성공 ${r.solved.length} (한도 ${HARD_CAP})`);
  if (r.solved.length) console.log(`추측 수 — 최소 ${r.solved[0]} · 25% ${r.q(0.25)} · 중앙 ${r.q(0.5)} · 75% ${r.q(0.75)} · 최대 ${r.solved[r.solved.length - 1]}`);
  console.log(`${MAX_GUESSES}번째 추측 시점 완성 함선 평균 ${(r.atCap.reduce((a, b) => a + b, 0) / GAMES).toFixed(1)}`);
  console.log([15, 20, 25, 30, 40, 60].map((cap) => `${cap}회 ${pct(r.solved.filter((n) => n <= cap).length)}`).join(' · '));
}
