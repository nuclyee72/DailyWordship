/**
 * simulate.mjs — 밸런스 측정용 봇 대국. 추측 한도(MAX_GUESSES)와 생성기 품질 기준을 정할 때 쓴다.
 *
 *   node scripts/simulate.mjs [판 수=200] [모드=standard|idiom] [시드 접두사=sim]
 *
 * 측정 기록은 docs/GDD.md §5.3.
 *
 * 봇은 사람을 흉내 낸다 — 출제 풀 단어를 알고, 보드에서 그 초성열이 보이는 박스를 찾아 추측한다.
 *  1) 함선 칸으로 확인됐지만 아직 완성 안 된 칸이 있으면: 그 칸을 지나는 박스를 알려진 음절에 맞는 단어로 메우기
 *  2) 없으면: 아직 안 해 본 '그럴듯한 박스'(출제어 초성열과 맞는 박스)를 긴 것부터 하나 골라 찍기
 * 화면에 보이는 사실(명중·빈칸·공개 음절)과 기록에서 알 수 있는 사실(이 칸은 이 음절이 아니다)로 후보를 거른다.
 * 한도 없이 끝까지 두게 해서, 몇 번 만에 풀었는지 분포를 본다.
 */
import { loadAnswerPool } from './lib/words.mjs';
import { generatePuzzle } from '../src/game/generator.js';
import { computeState, shipMap } from '../src/game/game.js';
import { modeOf } from '../src/game/modes.js';
import { allBoxes, boxCells, CELL_COUNT } from '../src/game/board.js';

const GAMES = Number(process.argv[2]) || 200;
const MODE = modeOf(process.argv[3] || 'standard');
const PREFIX = process.argv[4] || 'sim';
const MAX_GUESSES = MODE.maxGuesses;
const HARD_CAP = 80;

const pool = loadAnswerPool(MODE.id);
const BOXES = [4, 3, 2].flatMap((len) => allBoxes(len).map((box) => ({ ...box, cells: boxCells(box), key: `${box.r},${box.c},${box.dir},${len}` })));
const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];

function playBot(puzzle) {
  const map = shipMap(puzzle);
  const guesses = [];
  const tried = new Set();
  const triedBox = new Set();
  const notSyl = Array.from({ length: CELL_COUNT }, () => new Set());
  let state = computeState(puzzle, guesses, { maxGuesses: Infinity });
  let atCap = null;

  const patternOf = (b) => b.cells.map((i) => puzzle.onsets[i]).join('');
  const doneCell = (i) => map[i] && state.completed[map[i].ship];
  const isOpen = (i) => state.hit[i] && !doneCell(i);
  const fits = (b, w) => !tried.has(`${b.key}|${w}`)
    && b.cells.every((i, k) => (state.revealed[i] ? state.revealed[i] === w[k] : !notSyl[i].has(w[k])));
  const usable = (b) => !b.cells.some((i) => doneCell(i) || state.miss[i]);

  while (state.status !== 'won' && guesses.length < HARD_CAP) {
    let choice = null;
    const open = [];
    for (const b of BOXES) {
      if (!usable(b)) continue;
      const hits = b.cells.filter(isOpen).length;
      if (!hits) continue;
      const words = pool.matching(patternOf(b)).filter((w) => fits(b, w));
      if (words.length) open.push({ b, words, score: hits * 10 + b.len });
    }
    if (open.length) {
      const best = Math.max(...open.map((o) => o.score));
      const o = rand(open.filter((x) => x.score === best));
      choice = { b: o.b, w: rand(o.words) };
    } else {
      for (const fresh of [true, false]) {
        for (const len of [4, 3, 2]) {
          const cands = BOXES.filter((b) => b.len === len && usable(b) && (!fresh || !triedBox.has(b.key)))
            .map((b) => ({ b, words: pool.matching(patternOf(b)).filter((w) => fits(b, w)) }))
            .filter((x) => x.words.length);
          if (cands.length) { const x = rand(cands); choice = { b: x.b, w: rand(x.words) }; break; }
        }
        if (choice) break;
      }
    }
    if (!choice) break;
    const { b, w } = choice;
    tried.add(`${b.key}|${w}`);
    triedBox.add(b.key);
    guesses.push({ r: b.r, c: b.c, dir: b.dir, len: b.len, word: w });
    state = computeState(puzzle, guesses, { maxGuesses: Infinity });
    b.cells.forEach((i, k) => {
      if (!state.revealed[i]) notSyl[i].add(w[k]);
    });
    if (guesses.length === MAX_GUESSES) atCap = state.completed.filter(Boolean).length;
  }
  return { solvedAt: state.status === 'won' ? guesses.length : null, atCap: atCap ?? state.completed.filter(Boolean).length };
}

const solved = [];
const atCap = [];
const t0 = Date.now();
for (let i = 0; i < GAMES; i++) {
  const r = playBot(generatePuzzle(`${PREFIX}:${i}`, pool, { fleet: MODE.fleet, minDecoys: MODE.minDecoys }));
  if (r.solvedAt) solved.push(r.solvedAt);
  atCap.push(r.atCap);
}
solved.sort((a, b) => a - b);
const pct = (n) => `${((n / GAMES) * 100).toFixed(0)}%`;
const q = (p) => solved[Math.min(solved.length - 1, Math.floor(solved.length * p))];
console.log(`[${MODE.label}] ${GAMES}판 · ${((Date.now() - t0) / 1000).toFixed(1)}초 · 풀이 성공 ${solved.length} (한도 ${HARD_CAP})`);
if (solved.length) console.log(`추측 수 — 최소 ${solved[0]} · 25% ${q(0.25)} · 중앙 ${q(0.5)} · 75% ${q(0.75)} · 최대 ${solved[solved.length - 1]}`);
console.log(`${MAX_GUESSES}번째 추측 시점 완성 함선 평균 ${(atCap.reduce((a, b) => a + b, 0) / GAMES).toFixed(1)}`);
console.log([15, 20, 25, 30, 40, 60].map((cap) => `${cap}회 ${pct(solved.filter((n) => n <= cap).length)}`).join(' · '));
