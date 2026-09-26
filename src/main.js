import { dateStrKST, shiftDateStr, msUntilNextReset, formatCountdown } from './daily/dateUtil.js';
import { loadProgress, saveProgress, recordResult, summarize, distBuckets } from './daily/storage.js';
import { buildShareText, buildFleetGrid, buildSummaryLine, buildCalendarShareText } from './daily/share.js';
import { buildAnswerPool, buildGuessDictionary, fetchWordTexts } from './core/dictionary.js';
import { onsetOf } from './core/hangul.js';
import { geoOf, DIR_ARROW } from './game/board.js';
import { computeState, validateGuess, shipMap, cellOutcomes, parsePuzzle, guessRules, boxProblem } from './game/game.js';
import { MODES, modeOf } from './game/modes.js';
import { GIMMICKS, gimmickLine, randomGimmicks, CHECKPOINTS, GRAY_EVERY } from './game/gimmicks.js';
import { BoardRenderer } from './ui/BoardRenderer.js';
import { playEasterEgg } from './ui/easterEgg.js';
import { initHub, leaveToHub, goHub, saveDarkMode } from './hub.js';

const SITE_URL = 'https://nuclyee72.github.io/DailyWordship/';
const DAILY_FIRST_DATE = '2026-09-23'; // 아카이브에서 고를 수 있는 가장 이른 날짜
const TODAY = () => dateStrKST();
// 배포 주소에선 메인 화면 = 허브 카드 (index.html <head>가 표시) — 게임 자체 랜딩은 로컬 개발에서만
const HUB_ONLY = document.documentElement.dataset.hubOnly === '1';
/** '메인 화면'으로 — 배포 주소면 언제나 허브, 로컬이면 허브에서 온 탭만 허브(아니면 게임 랜딩) */
function backToMain() {
  if (HUB_ONLY) goHub();
  else if (!leaveToHub()) showLanding();
}

// ── DOM ──
const $ = (id) => document.getElementById(id);
const landingScreen   = $('landing-screen');
const gameScreen      = $('game-screen');
const landingMain     = $('landing-main');
const landingArchive  = $('landing-archive');
const landingCard     = document.querySelector('.landing-card');
const landingDate     = $('landing-date');
const dailyCardStatus = { standard: $('daily-card-status'), extended: $('daily-card-status-extended'), idiom: $('daily-card-status-idiom') };
const dailyLoadNote   = $('daily-load-note');
const dailyErrorEl    = $('daily-error');

const btnDailyPlay    = { standard: $('btn-daily-play'), extended: $('btn-daily-play-extended'), idiom: $('btn-daily-play-idiom') };
const btnFreePlay     = $('btn-free-play');
const freeplayModeModal = $('freeplay-mode-modal');
const btnFreeplayModeCancel = $('btn-freeplay-mode-cancel');
const archiveTypeBtns = document.querySelectorAll('#landing-archive .archive-type');
const statsTabBtns    = document.querySelectorAll('#daily-stats-modal .daily-stats-tab');
const btnArchive      = $('btn-archive');
const btnLandingStats = $('btn-landing-stats');
const btnLandingDark  = $('btn-landing-dark');
const btnGoLanding    = $('btn-go-landing');
const btnGameStats    = $('btn-game-stats');
const btnGameHelp     = $('btn-game-help');
const btnViewAnswer   = $('btn-view-answer');
const btnNewFree      = $('btn-new-free');

const boardEl     = $('ws-board');
const fleetEl     = $('ws-fleet');
const modeLabelEl = $('ws-mode-label');
const gameEl      = document.querySelector('.ws-game');
const elementSidebar = $('element-sidebar');
const relaxedNoteEl  = $('ws-relaxed-note');
const guessesLeftEl = $('ws-guesses-left');
const guessesMaxEl  = $('ws-guesses-max');
const guessForm   = $('ws-guess-form');
const slotsEl     = $('ws-slots');
const wordInput   = $('ws-word-input');
const btnSubmit   = $('btn-submit-guess');
const messageEl   = $('ws-message');
const historyEl   = $('ws-history');

const archiveCalEl    = $('archive-cal');
const archiveCalTitle = $('archive-cal-title');
const archiveCalPrev  = $('archive-cal-prev');
const archiveCalNext  = $('archive-cal-next');
const archiveErrorEl  = $('archive-error');
const btnArchivePlay  = $('btn-archive-play');

const dailyResultModal  = $('daily-result-modal');
const dailyResultTitle  = $('daily-result-title');
const dailyResultDetail = $('daily-result-detail');
const dailyResultGrid   = $('daily-result-grid');
const btnDailyResultShare = $('btn-daily-result-share');
const btnDailyResultStats = $('btn-daily-result-stats');
const btnDailyResultClose = $('btn-daily-result-close');
const dailyShareNote      = $('daily-share-note');

const dailyStatsModal  = $('daily-stats-modal');
const dailyStatsClose  = $('daily-stats-close');
const statPlayed    = $('stat-played');
const statWinRate   = $('stat-winrate');
const statStreak    = $('stat-streak');
const statMaxStreak = $('stat-maxstreak');
const dailyStatsDist = $('daily-stats-dist');
const dailyStatsCal  = $('daily-stats-cal');
const dailyCalTitle  = $('daily-cal-title');
const dailyCalPrev   = $('daily-cal-prev');
const dailyCalNext   = $('daily-cal-next');
const btnCalShare    = $('btn-cal-share');
const calShareNote   = $('cal-share-note');
const dailyNextCountdown = $('daily-next-countdown');
const btnDailyStatsShare = $('btn-daily-stats-share');
const dailyStatsShareNote = $('daily-stats-share-note');

const gameHelpModal = $('game-help-modal');
const gameHelpClose = $('game-help-close');

function openPanel(el) { el.classList.add('show'); }
function closePanel(el) { el.classList.remove('show'); }

// ── 화면 전환 ──
function showLanding() {
  gameScreen.classList.add('hidden');
  landingScreen.classList.remove('hidden');
  landingMain.hidden = false;
  landingArchive.hidden = true;
  landingCard.classList.remove('landing-card--archive');
  wordInput.blur();
  refreshLandingCard();
}
function showGame() {
  landingScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');
}

// ── 단어 데이터 ──
// 추측 사전(약 2.8MB, gzip 전송)은 첫 화면이 뜬 뒤 바로 백그라운드로 받아 둔다. 출제 풀은 자유 연습에서만 필요.
let guessDictPromise = null;
const loadGuessDict = () => {
  guessDictPromise ??= Promise.all([
    fetchWordTexts('guesses'),
    fetch('src/data/compound-parts.txt').then((res) => {
      if (!res.ok) throw new Error(`compound-parts.txt 불러오기 실패 (${res.status})`);
      return res.text();
    }),
  ]).then(([texts, parts]) => buildGuessDictionary(texts, parts)).catch((err) => {
    guessDictPromise = null;
    throw err;
  });
  return guessDictPromise;
};
// 모드별 출제 풀 — 스탠다드·익스텐디드는 answers-{2,3,4}.txt, 사자성어는 answers-idiom.txt
const answerPoolPromises = new Map();
const loadAnswerPool = (mode) => {
  const key = mode.answersFile ?? 'answers';
  if (!answerPoolPromises.has(key)) {
    const texts = mode.answersFile
      ? fetch(`src/data/${mode.answersFile}`).then((res) => {
        if (!res.ok) throw new Error(`${mode.answersFile} 불러오기 실패 (${res.status})`);
        return res.text();
      }).then((text) => ({ 4: text }))
      : Promise.all([fetchWordTexts('answers'), fetch('src/data/answers-simple.txt').then((res) => (res.ok ? res.text() : ''))])
        .then(([byLen, simple]) => ({ ...byLen, simple }));
    answerPoolPromises.set(key, texts.then(({ simple = '', ...byLen }) => buildAnswerPool(byLen, simple)).catch((err) => {
      answerPoolPromises.delete(key);
      throw err;
    }));
  }
  return answerPoolPromises.get(key);
};

// ── 데일리 퍼즐 로딩(캐시) ──
const puzzleCache = new Map();
async function loadDailyPuzzle(date, mode) {
  const file = mode.fileName(date);
  if (puzzleCache.has(file)) return puzzleCache.get(file);
  const res = await fetch(`daily/${file}.json`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${file} 퍼즐을 찾을 수 없음`);
  const puzzle = parsePuzzle(await res.json());
  puzzleCache.set(file, puzzle);
  return puzzle;
}

// ── 게임 세션 ──
/** @type {{ kind: 'daily'|'archive'|'free', date: string, puzzle: object, guesses: object[], map: object[], geo: object } | null} */
let session = null;
let state = null;
let rules = null; // guessRules — 잠긴 칸 · 못 쓰는 칸 · 못 쓰는 길이 (익스텐디드 기믹)
let selection = null;
let viewingAnswer = false;
let resultShown = false;

const renderer = new BoardRenderer(boardEl, { onSelect: handleSelect });

// 보드 가장자리 좌표 라벨 (8×8이면 a~h · 1~8, 10×10이면 a~j · 1~10)
function renderCoordLabels(size) {
  const label = (text) => { const s = document.createElement('span'); s.textContent = text; return s; };
  document.querySelector('.ws-col-labels').replaceChildren(...Array.from({ length: size }, (_, c) => label(String.fromCharCode(97 + c))));
  document.querySelector('.ws-row-labels').replaceChildren(...Array.from({ length: size }, (_, r) => label(String(r + 1))));
}
renderCoordLabels(8);

/** 공유 제목 — '데일리 워드십 · 2026-09-24', '데일리 워드십 · 사자성어 · 2026-09-24', '데일리 워드십 · 사자성어 · 자유 연습' */
function titleFor(mode, dateOrLabel) {
  return ['데일리 워드십', mode.id === 'standard' ? null : mode.label, dateOrLabel].filter(Boolean).join(' · ');
}
function sessionTitle() {
  return titleFor(session.mode, session.kind === 'free' ? '자유 연습' : session.date);
}

function persist() {
  if (session?.kind !== 'daily') return;
  saveProgress({
    date: session.date,
    onsets: session.puzzle.onsets.join(''),
    guesses: session.guesses,
    used: state.used,
    status: state.status === 'won' ? 'solved' : state.status === 'lost' ? 'failed' : 'playing',
  }, session.mode.id);
}

/** @param {{ kind, date, mode: string, puzzle, guesses }} newSession */
function openGame(newSession) {
  session = { ...newSession, mode: modeOf(newSession.mode), map: shipMap(newSession.puzzle), geo: geoOf(newSession.puzzle) };
  resultShown = false;
  viewingAnswer = false;
  selection = null;
  renderer.setSize(session.geo.size);
  renderCoordLabels(session.geo.size);
  renderElementSidebar();
  renderer.setSelection(null, { silent: true });
  wordInput.value = '';
  setMessage('');
  showGame();
  renderGame();
  // 이미 끝난 판(오늘 데일리를 다시 연 경우)이면 결과창을 다시 띄우지는 않는다
  if (state.status !== 'playing') resultShown = true;
}

function renderGame() {
  const { maxGuesses } = session.mode;
  state = computeState(session.puzzle, session.guesses, { maxGuesses });
  rules = guessRules(session.puzzle, session.guesses);
  const playing = state.status === 'playing';
  const doneShips = session.puzzle.ships.filter((_, s) => state.completed[s]);
  const doneCells = new Set(doneShips.flatMap((s) => session.geo.boxCells(s)));
  renderer.render({
    onsets: session.puzzle.onsets,
    revealed: state.revealed,
    hit: state.hit,
    miss: state.miss,
    doneCells,
    doneShips,
    answerShips: viewingAnswer ? session.puzzle.ships.filter((_, s) => !state.completed[s]) : [],
    interactive: playing,
    // 판이 끝나면 잠긴 칸도 걷히고, 못 쓰는 칸 빗금도 지운다
    hidden: playing ? rules.hidden : null,
    blocked: playing ? rules.blocked : null,
    holes: rules.holes,
  });

  const left = Math.max(0, maxGuesses - state.used);
  guessesLeftEl.textContent = String(left);
  guessesMaxEl.textContent = `/ ${maxGuesses}`;
  guessesLeftEl.parentElement.classList.toggle('is-low', playing && left <= 3);
  const where = session.kind === 'free' ? '자유 연습' : session.kind === 'archive' ? `${session.date} · 지난 퍼즐` : session.date;
  modeLabelEl.textContent = `${session.mode.label} · ${where}`;

  renderFleet();
  renderGimmickStatus();
  renderHistory();
  renderSlots();

  wordInput.disabled = !playing || !selection;
  btnSubmit.disabled = !playing || !selection;
  guessForm.classList.toggle('is-over', !playing);
  if (!playing) {
    wordInput.value = '';
    wordInput.placeholder = state.status === 'won' ? '모든 함선을 찾았어요!' : '추측을 모두 썼어요';
  } else if (!selection) {
    wordInput.placeholder = '';
  }

  btnViewAnswer.hidden = state.status !== 'lost';
  btnViewAnswer.textContent = viewingAnswer ? '내 결과 보기' : '정답 보기';
  btnNewFree.hidden = !(session.kind === 'free' && !playing);
}

function renderFleet() {
  const ships = session.puzzle.ships.map((s, i) => ({ s, i })).sort((a, b) => b.s.len - a.s.len);
  fleetEl.replaceChildren(...ships.map(({ s, i }) => {
    const chip = document.createElement('span');
    chip.className = 'ws-fleet-ship';
    const done = state.completed[i];
    const shown = done || (viewingAnswer && state.status !== 'playing');
    chip.classList.toggle('is-done', done);
    chip.classList.toggle('is-answer', shown && !done);
    for (let k = 0; k < s.len; k++) {
      const seg = document.createElement('i');
      if (shown) seg.textContent = s.name[k];
      chip.appendChild(seg);
    }
    chip.title = done ? s.name : `${s.len}칸 함선`;
    return chip;
  }));
}

// ── 기믹 안내 사이드바 (책갈피) — 데일리 스도쿠 익스텐디드의 요소 책갈피와 같은 방식 ──
// 기믹마다 독립된 책갈피 하나씩: 화면 왼쪽 끝의 손잡이(아이콘)를 누르면 이름·설명이 밀려 나온다.
// 판을 열 때 한 번 만들고(열어 둔 책갈피가 추측마다 닫히지 않게), 추측마다 오른쪽 위 배지(지금 상태)만 고친다.
function renderElementSidebar() {
  elementSidebar.innerHTML = '';
  const ids = session.puzzle.gimmicks;
  gameEl.classList.toggle('has-sidebar', ids.length > 0);
  if (!ids.length) {
    elementSidebar.hidden = true;
    return;
  }
  for (const id of ids) {
    const info = GIMMICKS[id];
    const bm = document.createElement('div');
    bm.className = 'element-bookmark';
    bm.dataset.gimmick = id;
    bm.innerHTML =
      `<div class="element-bookmark-body">` +
      `<span class="element-bookmark-head"><b>${info.icon}</b> ${info.label}<em></em></span>` +
      `<span class="element-bookmark-desc">${info.help}</span>` +
      `</div>` +
      `<button class="element-bookmark-handle" type="button" aria-label="${info.label} 설명 열기/닫기">` +
      `<span class="element-bookmark-icon">${info.icon}</span></button>`;
    bm.querySelector('.element-bookmark-handle')
      .addEventListener('click', () => bm.classList.toggle('open'));
    elementSidebar.appendChild(bm);
  }
  elementSidebar.hidden = false;
}

/** 책갈피 배지 — 기믹의 지금 상태 (이번엔 4글자 ✕, 10번째 격침 필수 …) */
function renderGimmickStatus() {
  const playing = state.status === 'playing';
  const hiddenLeft = rules.hidden.filter(Boolean).length;
  const next = session.guesses.length + 1; // 이번 추측이 몇 번째인지
  const lastResult = state.results[state.results.length - 1];
  elementSidebar.querySelectorAll('.element-bookmark').forEach((bm) => {
    const id = bm.dataset.gimmick;
    let detail = GIMMICKS[id].short;
    if (playing && id === 'alternate' && rules.banLen) detail = `이번엔 ${rules.banLen}글자 ✕`;
    if (playing && id === 'turn' && rules.banDir) detail = `이번엔 ${DIR_ARROW[rules.banDir]} ✕`;
    if (playing && (id === 'fog' || id === 'cross')) detail = `잠긴 칸 ${hiddenLeft}`;
    if (playing && id === 'noOrange' && lastResult?.usedOrange) detail = '이번엔 주황 ✕';
    if (playing && id === 'noYellow' && lastResult?.usedYellow) detail = '이번엔 노랑 ✕';
    if (id === 'reserve') detail = `남은 칸 ${state.untouched} · 최소 ${state.reserveNeed}`;
    if (playing && id === 'gray3') {
      const k = GRAY_EVERY - ((next - 1) % GRAY_EVERY) - 1; // 회색 필수까지 남은 추측
      detail = k ? `${k}번 뒤 회색` : rules.mustGray ? '이번엔 회색 필수' : '이번엔 면제';
    }
    if (playing && id === 'checkpoint') {
      const cp = CHECKPOINTS.find((c) => c >= next);
      detail = !cp ? '관문 끝' : cp === next ? '이번엔 격침 필수' : `${cp - next}번 뒤 관문`;
    }
    bm.querySelector('em').textContent = detail;
  });
  // 기믹끼리 겹쳐 둘 곳이 없으면 이번 한 번은 제약이 풀린다 (game.js guessRules)
  relaxedNoteEl.hidden = !(playing && rules.relaxed);
}

function renderHistory() {
  historyEl.replaceChildren(...session.guesses.map((g, n) => {
    const li = document.createElement('li');
    li.className = 'ws-history-item';
    const num = document.createElement('span');
    num.className = 'ws-history-num';
    num.textContent = String(n + 1);
    const where = document.createElement('span');
    where.className = 'ws-history-where';
    where.textContent = session.geo.boxLabel(g);
    const word = document.createElement('span');
    word.className = 'ws-history-word';
    const outcomes = cellOutcomes(session.puzzle, g, session.map);
    const result = state.results[n];
    // 함선을 완성한 추측은 초록 줄
    const sunk = !!result?.completedShips.length;
    li.classList.toggle('is-sunk', sunk);
    [...g.word].forEach((ch, k) => {
      const b = document.createElement('b');
      b.className = `ws-chip ws-chip--${sunk ? 'done' : outcomes[k]}`;
      b.textContent = ch;
      word.appendChild(b);
    });
    li.append(num, word, where);
    // 기믹 벌점 — 길이 3 선호(−2) · 관문(−5). 관문 통과는 초록 배지
    const badge = (text, title, bonus = false) => {
      const b = document.createElement('span');
      b.className = bonus ? 'ws-history-cost is-bonus' : 'ws-history-cost';
      b.textContent = text;
      b.title = title;
      li.appendChild(b);
    };
    if (result?.cost > 1) badge(`−${result.cost}`, `추측 ${result.cost}번 소모 (길이 3 선호)`);
    if (result?.cost < 0) badge(`+${-result.cost}`, `이스터에그 — 추측 ${-result.cost}번 늘어남`, true);
    if (result?.penalty) badge(`🚩−${result.penalty}`, `관문 실패 — 추측 ${result.penalty}번 더 줄어듦`);
    else if (result && session.puzzle.gimmicks.includes('checkpoint') && CHECKPOINTS.includes(n + 1)) badge('🚩', '관문 통과', true);
    li.addEventListener('click', () => renderer.flash(g));
    return li;
  }).reverse());
}

// ── 선택 · 입력 ──
function handleSelect(box) {
  selection = box;
  if (!state || state.status !== 'playing') return;
  // 선택이 풀리거나 다른 칸으로 바뀌면 쓰던 입력은 버린다
  wordInput.value = '';
  setMessage('');
  // 기믹 때문에 못 고르는 자리면(길이 바꾸기 · 거리 두기) 입력 전에 바로 알려 준다
  const problem = box && boxProblem(session.puzzle, session.guesses, box, rules);
  wordInput.disabled = !box || !!problem;
  btnSubmit.disabled = !box || !!problem;
  if (problem) {
    setMessage(problem, 'error');
    wordInput.placeholder = '';
    wordInput.blur();
  } else if (box) {
    const hint = session.geo.boxCells(box).map((i) => (rules.hidden[i] ? '?' : session.puzzle.onsets[i])).join(' ');
    wordInput.placeholder = `${hint} — ${box.len}글자 명사`;
    wordInput.focus({ preventScroll: true });
  } else {
    wordInput.placeholder = '';
  }
  renderSlots();
}

function renderSlots() {
  slotsEl.replaceChildren();
  if (!selection || !state || state.status !== 'playing') return;
  const cells = session.geo.boxCells(selection);
  const typed = [...wordInput.value.replace(/\s+/g, '')];
  cells.forEach((idx, i) => {
    const slot = document.createElement('span');
    slot.className = 'ws-slot';
    const locked = rules.hidden[idx]; // 잠긴 칸 — 아무 초성이나
    const want = session.puzzle.onsets[idx];
    const ch = typed[i];
    if (ch) {
      slot.textContent = ch;
      const on = onsetOf(ch);
      if (on) slot.classList.add(locked || on === want ? 'is-ok' : 'is-bad');
    } else {
      slot.textContent = locked ? '?' : want;
      slot.classList.add('is-empty');
    }
    slotsEl.appendChild(slot);
  });
  if (typed.length > cells.length) slotsEl.lastChild.classList.add('is-bad');
}
// 입력칸에는 한글(완성 글자 + 조합 중인 자모)만 — 영어·숫자·공백·특수문자는 들어오는 즉시 지운다.
// 한글 입력기가 글자를 조합하는 중에 값을 바꾸면 조합이 깨지므로, 조합이 끝났을 때만 거른다.
const NOT_HANGUL = /[^가-힣ㄱ-ㅎㅏ-ㅣ]/g;
function stripNonHangul() {
  const { value } = wordInput;
  if (!NOT_HANGUL.test(value)) return;
  NOT_HANGUL.lastIndex = 0;
  const caret = wordInput.selectionStart ?? value.length;
  const removedBeforeCaret = (value.slice(0, caret).match(NOT_HANGUL) || []).length;
  wordInput.value = value.replace(NOT_HANGUL, '');
  const pos = caret - removedBeforeCaret;
  wordInput.setSelectionRange(pos, pos);
}
wordInput.addEventListener('input', (e) => {
  if (!e.isComposing) stripNonHangul();
  renderSlots();
});
wordInput.addEventListener('compositionend', () => { stripNonHangul(); renderSlots(); });

function setMessage(text, kind = '') {
  messageEl.textContent = text;
  messageEl.dataset.kind = kind;
}

let submitting = false;
guessForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!session || state.status !== 'playing' || !selection || submitting) return;
  submitting = true;
  try {
    let dict;
    try {
      setMessage('사전을 불러오는 중...');
      dict = await loadGuessDict();
      setMessage('');
    } catch (err) {
      console.error(err);
      setMessage('사전을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.', 'error');
      return;
    }
    const v = validateGuess(session.puzzle, session.guesses, selection, wordInput.value, dict);
    if (!v.ok) {
      setMessage(v.reason, 'error');
      slotsEl.classList.remove('shake');
      void slotsEl.offsetWidth;
      slotsEl.classList.add('shake');
      return;
    }
    session.guesses.push({ r: selection.r, c: selection.c, dir: selection.dir, len: selection.len, word: v.word });
    playEasterEgg(v.word);
    wordInput.value = '';
    renderer.setSelection(null, { silent: true });
    selection = null;
    afterGuess();
  } finally {
    submitting = false;
  }
});

function afterGuess() {
  renderGame();
  persist();
  // 도넛 바다 — 함선이 1척 남아 그 함선 칸 하나가 주황으로 열렸다
  const donutHint = state.status === 'playing' ? state.results[state.results.length - 1]?.donutHint : null;
  setMessage(donutHint != null ? `${GIMMICKS.donut.icon} 마지막 함선 — ${session.geo.cellLabel(donutHint)} 칸 주황 공개` : '');
  if (state.status !== 'playing' && !resultShown) {
    resultShown = true;
    wordInput.blur();
    if (session.kind === 'daily') {
      recordResult(session.date, state.status === 'won' ? 'solved' : 'failed', state.status === 'won' ? state.used : null, session.mode.id);
    }
    setTimeout(showResultModal, 450);
  }
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || gameScreen.classList.contains('hidden')) return;
  if (document.querySelector('.modal-overlay.show')) return;
  renderer.setSelection(null);
});

// 개발용 치트 — 콘솔에서 __solve() 하면 남은 함선 이름을 그대로 추측해서 판을 끝낸다
// (사전 검사 없이 넣는다. 로컬 기록만 건드리는 개인 퍼즐이라 다른 사람에게 영향 없음)
window.__solve = () => {
  if (!session || state.status !== 'playing') return;
  session.puzzle.ships.forEach((s, i) => {
    if (!state.completed[i]) session.guesses.push({ r: s.r, c: s.c, dir: s.dir, len: s.len, word: s.name });
  });
  afterGuess();
};
// 개발용 — 기믹을 골라 익스텐디드 자유 연습: __freePlay('extended', ['wide', 'fog'])
window.__freePlay = (modeId, gimmicks) => startFreePlay(modeId, gimmicks);

// ── 정답 보기 · 새 퍼즐 ──
btnViewAnswer.addEventListener('click', () => { viewingAnswer = !viewingAnswer; renderGame(); });
btnNewFree.addEventListener('click', () => startFreePlay(session.mode.id));

// ── 결과 모달 ──
function showResultModal() {
  const won = state.status === 'won';
  dailyResultTitle.textContent = won ? '🎉 함대 격파!' : '아쉬워요';
  // '미답 해역' — 안 쓴 칸이 모자라서 끝난 경우는 이유를 알려 준다
  const reason = state.lostBy === 'reserve' ? `\n🗺️ 안 쓴 칸이 ${state.reserveNeed}칸 밑으로 떨어졌어요 (남은 칸 ${state.untouched})` : '';
  const summary = buildSummaryLine(state, session.puzzle.ships.length, session.mode.maxGuesses);
  const where = session.kind === 'daily' ? session.date : session.kind === 'free' ? '자유 연습' : `${session.date} 지난 퍼즐`;
  const gimmicks = session.puzzle.gimmicks.length ? `\n${gimmickLine(session.puzzle.gimmicks)}` : '';
  dailyResultDetail.textContent = `${session.mode.label} · ${where} · ${summary}${session.kind === 'daily' ? '' : ' (기록에는 반영되지 않아요)'}${gimmicks}${reason}`;
  // 공유 텍스트와 같은 그림이지만, 화면에서는 칸 폭을 고정해 줄을 정확히 맞춘다 (공백 = 빈 칸)
  dailyResultGrid.replaceChildren(...buildFleetGrid(session.puzzle, state).split('\n').map((line) => {
    const row = document.createElement('div');
    row.className = 'ws-share-row';
    row.append(...Array.from(line, (ch) => {
      const cell = document.createElement('span');
      cell.textContent = ch.trim() ? ch : '';
      return cell;
    }));
    return row;
  }));
  dailyShareNote.textContent = '';
  openPanel(dailyResultModal);
}
btnDailyResultClose.addEventListener('click', () => closePanel(dailyResultModal));
dailyResultModal.addEventListener('click', (e) => { if (e.target === dailyResultModal) closePanel(dailyResultModal); });
btnDailyResultStats.addEventListener('click', () => { closePanel(dailyResultModal); openStatsModal(); });
btnDailyResultShare.addEventListener('click', async () => {
  const text = buildShareText({ title: sessionTitle(), puzzle: session.puzzle, state, url: SITE_URL, maxGuesses: session.mode.maxGuesses });
  const ok = await copyText(text);
  dailyShareNote.textContent = ok ? '클립보드에 복사했어요!' : '복사에 실패했어요.';
});

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

// ── 오늘의 퍼즐 (스탠다드 · 익스텐디드 · 사자성어) ──
async function startDaily(modeId) {
  const mode = modeOf(modeId);
  const date = TODAY();
  dailyLoadNote.hidden = false;
  dailyErrorEl.textContent = '';
  try {
    const puzzle = await loadDailyPuzzle(date, mode);
    const saved = loadProgress(date, mode.id);
    const guesses = saved && saved.onsets === puzzle.onsets.join('') ? saved.guesses : [];
    openGame({ kind: 'daily', date, mode: mode.id, puzzle, guesses: [...guesses] });
    persist();
  } catch (err) {
    dailyErrorEl.textContent = '퍼즐을 불러오지 못했어요. 잠시 후 다시 시도해주세요.';
    console.error(err);
  } finally {
    dailyLoadNote.hidden = true;
  }
}
Object.entries(btnDailyPlay).forEach(([id, btn]) => btn.addEventListener('click', () => startDaily(id)));

function refreshLandingCard() {
  landingDate.textContent = TODAY();
  for (const mode of Object.values(MODES)) {
    const el = dailyCardStatus[mode.id];
    const today = summarize(TODAY(), mode.id).results[TODAY()];
    if (today?.status === 'solved') { el.textContent = '성공'; el.dataset.status = 'solved'; }
    else if (today?.status === 'failed') { el.textContent = '실패'; el.dataset.status = 'timeout'; }
    else {
      const p = loadProgress(TODAY(), mode.id);
      if (p && p.guesses?.length) { el.textContent = `진행 중 · ${p.used ?? p.guesses.length}/${mode.maxGuesses}`; el.dataset.status = 'playing'; }
      else { el.textContent = '플레이 전'; el.dataset.status = 'new'; }
    }
  }
}

// ── 자유 연습 — 모드를 고르면 브라우저에서 즉석 생성 ──
async function startFreePlay(modeId, pickedGimmicks = null) {
  const mode = modeOf(modeId);
  try {
    const [pool, { generatePuzzle }] = await Promise.all([loadAnswerPool(mode), import('./game/generator.js')]);
    const gimmicks = mode.gimmicks ? (pickedGimmicks ?? randomGimmicks()) : [];
    const puzzle = generatePuzzle(`free:${Date.now()}:${Math.random()}`, pool, { fleet: mode.fleet, minDecoys: mode.minDecoys, gimmicks });
    openGame({ kind: 'free', date: '자유 연습', mode: mode.id, puzzle, guesses: [] });
  } catch (err) {
    dailyErrorEl.textContent = '자유 연습 퍼즐을 만들지 못했어요.';
    console.error(err);
    backToMain();
  }
}
btnFreePlay.addEventListener('click', () => openPanel(freeplayModeModal));
// 모드 고르기를 취소하면 메인 화면으로 — 배포 주소·허브에서 온 탭이면 허브
const cancelFreePlayModeModal = () => { if (HUB_ONLY) goHub(); else if (!leaveToHub()) closePanel(freeplayModeModal); };
btnFreeplayModeCancel.addEventListener('click', cancelFreePlayModeModal);
freeplayModeModal.addEventListener('click', (e) => { if (e.target === freeplayModeModal) cancelFreePlayModeModal(); });
freeplayModeModal.querySelectorAll('.daily-card').forEach((btn) => {
  btn.addEventListener('click', () => { closePanel(freeplayModeModal); startFreePlay(btn.dataset.mode); });
});

btnGoLanding.addEventListener('click', backToMain);

// ── 달력 (통계 · 지난 퍼즐 공용) ──
function makeCalendar({ gridEl, titleEl, prevEl, nextEl, pick = false, onPick = null }) {
  const CAL_WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
  let monthOffset = 0;
  let sum = { results: {} };
  let selected = null;
  let minDate = null, maxDate = null;

  function monthYM() {
    const [ty, tm] = TODAY().split('-').map(Number);
    const b = new Date(Date.UTC(ty, tm - 1 + monthOffset, 1));
    return { y: b.getUTCFullYear(), m: b.getUTCMonth() + 1 };
  }

  function render() {
    const today = TODAY();
    const { y, m } = monthYM();
    const mm = String(m).padStart(2, '0');
    titleEl.textContent = `${y}년 ${m}월`;
    if (nextEl) nextEl.disabled = monthOffset >= 0;
    if (prevEl) prevEl.disabled = !!minDate && `${y}-${mm}` <= minDate.slice(0, 7);

    const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();

    gridEl.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'cal-grid cal-head';
    for (const w of CAL_WEEKDAYS) {
      const c = document.createElement('span');
      c.className = 'cal-dow';
      c.textContent = w;
      head.appendChild(c);
    }
    gridEl.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'cal-grid';
    for (let i = 0; i < firstDow; i++) {
      const b = document.createElement('span');
      b.className = 'cal-cell cal-cell--blank';
      grid.appendChild(b);
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${y}-${mm}-${String(d).padStart(2, '0')}`;
      const r = sum.results[dateStr];
      const cell = document.createElement('span');
      cell.className = 'cal-cell';
      if (dateStr === today) cell.classList.add('cal-cell--today');
      if (pick && dateStr === selected) cell.classList.add('cal-cell--picked');
      const dayNum = document.createElement('span');
      dayNum.className = 'cal-day';
      dayNum.textContent = d;
      cell.appendChild(dayNum);
      if (r) {
        cell.classList.add('cal-cell--filled', r.status === 'solved' ? 'cal-cell--solved' : 'cal-cell--fail');
        // 스도쿠 달력처럼 칸에 기록 표시 — 성공: 맞힌 추측 수, 실패: ✕
        const v = document.createElement('span');
        v.className = 'cal-val';
        v.textContent = r.status === 'solved' && r.attempt ? `${r.attempt}번` : r.status === 'solved' ? '✓' : '✕';
        cell.appendChild(v);
      } else if (dateStr > today) cell.classList.add('cal-cell--future');
      else if (minDate && dateStr < minDate) cell.classList.add('cal-cell--locked');
      else cell.classList.add('cal-cell--miss');
      if (pick && minDate && maxDate && dateStr >= minDate && dateStr <= maxDate) {
        cell.classList.add('cal-cell--pickable');
        cell.addEventListener('click', () => { selected = dateStr; render(); onPick?.(dateStr); });
      }
      grid.appendChild(cell);
    }
    gridEl.appendChild(grid);
  }

  prevEl?.addEventListener('click', () => { monthOffset -= 1; render(); });
  nextEl?.addEventListener('click', () => { if (monthOffset < 0) { monthOffset += 1; render(); } });

  return {
    render, monthYM,
    open(summary, { selected: sel = null, minDate: mn = null, maxDate: mx = null, resetMonth = true } = {}) {
      sum = summary; selected = sel; minDate = mn; maxDate = mx;
      if (resetMonth) monthOffset = 0;
      render();
    },
  };
}

// ── 지난 퍼즐(아카이브) ──
let archiveSelected = null;
let archiveMode = 'standard'; // 아카이브 안에서만 쓰는 모드 전환 — 들어올 때마다 스탠다드부터
const archiveCal = makeCalendar({
  gridEl: archiveCalEl, titleEl: archiveCalTitle, prevEl: archiveCalPrev, nextEl: archiveCalNext,
  pick: true,
  onPick: (d) => { archiveSelected = d; btnArchivePlay.disabled = false; archiveErrorEl.textContent = ''; },
});
function paintArchiveCal(resetMonth) {
  archiveTypeBtns.forEach((b) => b.classList.toggle('active', b.dataset.mode === archiveMode));
  archiveCal.open(summarize(TODAY(), archiveMode), {
    selected: archiveSelected, minDate: DAILY_FIRST_DATE, maxDate: shiftDateStr(TODAY(), -1), resetMonth,
  });
}

btnArchive.addEventListener('click', () => {
  landingMain.hidden = true;
  landingArchive.hidden = false;
  landingCard.classList.add('landing-card--archive');
  archiveSelected = null;
  archiveMode = 'standard';
  btnArchivePlay.disabled = true;
  archiveErrorEl.textContent = TODAY() <= DAILY_FIRST_DATE ? '아직 지난 퍼즐이 없어요 — 내일부터 열려요.' : '';
  paintArchiveCal(true);
});
archiveTypeBtns.forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.mode === archiveMode) return;
  archiveMode = b.dataset.mode;
  archiveErrorEl.textContent = '';
  paintArchiveCal(false); // 달·고른 날짜는 유지하고 그 모드의 결과 색만 다시 칠함
}));

btnArchivePlay.addEventListener('click', async () => {
  if (!archiveSelected) return;
  try {
    const puzzle = await loadDailyPuzzle(archiveSelected, modeOf(archiveMode));
    openGame({ kind: 'archive', date: archiveSelected, mode: archiveMode, puzzle, guesses: [] });
  } catch (err) {
    archiveErrorEl.textContent = '그 날짜의 퍼즐을 불러오지 못했어요.';
    console.error(err);
  }
});

// ── 통계 모달 ──
const statsCal = makeCalendar({ gridEl: dailyStatsCal, titleEl: dailyCalTitle, prevEl: dailyCalPrev, nextEl: dailyCalNext });
let statsCountdownTimer = null;
let statsMode = 'standard'; // 탭으로 전환 — 모달이 열려 있는 동안만 유지

function renderStats() {
  statsTabBtns.forEach((b) => b.classList.toggle('active', b.dataset.mode === statsMode));
  const s = summarize(TODAY(), statsMode);
  statPlayed.textContent = s.played;
  statWinRate.textContent = s.winRate;
  statStreak.textContent = s.curStreak;
  statMaxStreak.textContent = s.maxStreak;
  statsCal.open(s, { minDate: DAILY_FIRST_DATE });

  dailyStatsDist.innerHTML = '';
  const max = Math.max(1, ...s.distribution);
  const buckets = distBuckets(statsMode);
  buckets.forEach((label, i) => {
    const count = s.distribution[i];
    const row = document.createElement('div');
    row.className = 'ws-dist-row';
    row.innerHTML = `<span class="ws-dist-label">${label}</span>
      <span class="ws-dist-track"><span class="ws-dist-fill${i === buckets.length - 1 ? ' is-fail' : ''}" style="width:${(count / max) * 100}%"></span></span>
      <span class="ws-dist-count">${count}</span>`;
    dailyStatsDist.appendChild(row);
  });
  dailyStatsShareNote.textContent = '';
  calShareNote.textContent = '';
}

/** 기본 탭은 지금 하고 있는 판의 모드 (없으면 스탠다드) */
function openStatsModal(modeId = session?.mode.id ?? 'standard') {
  statsMode = modeId;
  renderStats();
  openPanel(dailyStatsModal);
  clearInterval(statsCountdownTimer);
  const tick = () => { dailyNextCountdown.textContent = formatCountdown(msUntilNextReset()); };
  tick();
  statsCountdownTimer = setInterval(tick, 1000);
}
function closeStatsModal() { closePanel(dailyStatsModal); clearInterval(statsCountdownTimer); }
dailyStatsClose.addEventListener('click', closeStatsModal);
dailyStatsModal.addEventListener('click', (e) => { if (e.target === dailyStatsModal) closeStatsModal(); });
btnLandingStats.addEventListener('click', () => openStatsModal('standard'));
btnGameStats.addEventListener('click', () => openStatsModal());
statsTabBtns.forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.mode === statsMode) return;
  statsMode = b.dataset.mode;
  renderStats();
}));

btnCalShare.addEventListener('click', async () => {
  const { y, m } = statsCal.monthYM();
  const mode = modeOf(statsMode);
  const text = buildCalendarShareText({
    results: summarize(TODAY(), mode.id).results, year: y, month: m, url: SITE_URL,
    label: mode.id === 'standard' ? '' : mode.label,
  });
  calShareNote.textContent = (await copyText(text)) ? '복사했어요!' : '복사 실패';
});
btnDailyStatsShare.addEventListener('click', async () => {
  const mode = modeOf(statsMode);
  const p = loadProgress(TODAY(), mode.id);
  if (!p || p.status === 'playing') { dailyStatsShareNote.textContent = '오늘 퍼즐을 먼저 풀어주세요.'; return; }
  const puzzle = await loadDailyPuzzle(TODAY(), mode);
  const st = computeState(puzzle, p.guesses, { maxGuesses: mode.maxGuesses });
  const text = buildShareText({ title: titleFor(mode, TODAY()), puzzle, state: st, url: SITE_URL, maxGuesses: mode.maxGuesses });
  dailyStatsShareNote.textContent = (await copyText(text)) ? '복사했어요!' : '복사 실패';
});

// ── 도움말 ──
// 익스텐디드 기믹 목록은 책갈피와 같은 문구(GIMMICKS)로 채운다 — 분류별 한 줄에 '아이콘 이름 설명'
document.getElementById('help-gimmicks').replaceChildren(...[...new Set(Object.values(GIMMICKS).map((g) => g.group))].map((group) => {
  const line = document.createElement('span');
  line.className = 'help-gimmick';
  const title = document.createElement('b');
  title.className = 'help-gimmick-group';
  title.textContent = group;
  line.append(title, ...Object.values(GIMMICKS).filter((g) => g.group === group).map((g) => {
    const item = document.createElement('span');
    item.className = 'help-gimmick-item';
    const name = document.createElement('b');
    name.textContent = `${g.icon} ${g.label}`;
    item.append(name, ` ${g.help}`);
    return item;
  }));
  return line;
}));
function openHelpModal() { openPanel(gameHelpModal); }
gameHelpClose.addEventListener('click', () => closePanel(gameHelpModal));
gameHelpModal.addEventListener('click', (e) => { if (e.target === gameHelpModal) closePanel(gameHelpModal); });
btnGameHelp.addEventListener('click', openHelpModal);

// ── 다크 모드 ──
const DARK_MODE_KEY = 'wordship-dark-mode';
btnLandingDark.addEventListener('click', () => {
  const on = document.documentElement.getAttribute('data-theme') !== 'dark';
  document.documentElement.setAttribute('data-theme', on ? 'dark' : 'light');
  saveDarkMode(on); // 허브·다른 게임과 같이 (DARK_MODE_KEY 포함)
});

// ── 시작 ──
showLanding();
// 처음 방문이면 게임 방법부터
try {
  if (!localStorage.getItem('wordship:seen-help')) {
    openHelpModal();
    localStorage.setItem('wordship:seen-help', '1');
  }
} catch { /* 무시 */ }
loadGuessDict().catch((err) => console.error(err));

// ── 허브의 지난 퍼즐 달력에서 고른 날짜로 바로 시작 (?archive=YYYY-MM-DD&mode=standard|extended|idiom) ──
function playArchiveFromHub(date, mode) {
  if (!Object.hasOwn(MODES, mode) || date < DAILY_FIRST_DATE || date >= TODAY()) { backToMain(); return; }
  btnArchive.click();
  archiveMode = mode;
  archiveSelected = date;
  paintArchiveCal(true); // 모드 토글 active도 여기서 맞춘다
  btnArchivePlay.disabled = false;
  btnArchivePlay.click();
}
// ── 허브의 자유 연습 모드 고르기에서 바로 시작 (?free=standard|extended|idiom) ──
function playFreeFromHub(mode) {
  if (Object.hasOwn(MODES, mode)) startFreePlay(mode);
}
initHub('wordship', { playArchive: playArchiveFromHub, playFree: playFreeFromHub });
