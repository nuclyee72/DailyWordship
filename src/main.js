import { dateStrKST, shiftDateStr, msUntilNextReset, formatCountdown } from './daily/dateUtil.js';
import { loadProgress, saveProgress, recordResult, summarize, DIST_BUCKETS } from './daily/storage.js';
import { buildShareText, buildGuessEmojiGrid, buildSummaryLine, buildCalendarShareText } from './daily/share.js';
import { buildAnswerPool, buildGuessDictionary, fetchWordTexts } from './core/dictionary.js';
import { onsetOf } from './core/hangul.js';
import { boxCells, boxLabel, SIZE } from './game/board.js';
import { MAX_GUESSES, computeState, validateGuess, shipMap, cellOutcomes } from './game/game.js';
import { BoardRenderer } from './ui/BoardRenderer.js';

const SITE_URL = 'https://nuclyee72.github.io/WordShip/';
const DAILY_FIRST_DATE = '2026-09-23'; // 아카이브에서 고를 수 있는 가장 이른 날짜
const TODAY = () => dateStrKST();

// ── DOM ──
const $ = (id) => document.getElementById(id);
const landingScreen   = $('landing-screen');
const gameScreen      = $('game-screen');
const landingMain     = $('landing-main');
const landingArchive  = $('landing-archive');
const landingDate     = $('landing-date');
const dailyCardStatus = $('daily-card-status');
const dailyLoadNote   = $('daily-load-note');
const dailyErrorEl    = $('daily-error');

const btnDailyPlay    = $('btn-daily-play');
const btnFreePlay     = $('btn-free-play');
const btnArchive      = $('btn-archive');
const btnLandingHelp  = $('btn-landing-help');
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
const guessesLeftEl = $('ws-guesses-left');
const guessesMaxEl  = $('ws-guesses-max');
const guessForm   = $('ws-guess-form');
const slotsEl     = $('ws-slots');
const wordInput   = $('ws-word-input');
const btnSubmit   = $('btn-submit-guess');
const messageEl   = $('ws-message');
const historyEl   = $('ws-history');

const archiveBack     = $('archive-back');
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
  wordInput.blur();
  refreshLandingCard();
}
function showGame() {
  landingScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');
}

// ── 단어 데이터 ──
// 추측 사전(약 1.7MB)은 첫 화면이 뜬 뒤 바로 백그라운드로 받아 둔다. 출제 풀은 자유 연습에서만 필요.
let guessDictPromise = null;
const loadGuessDict = () => {
  guessDictPromise ??= fetchWordTexts('guesses').then(buildGuessDictionary).catch((err) => {
    guessDictPromise = null;
    throw err;
  });
  return guessDictPromise;
};
let answerPoolPromise = null;
const loadAnswerPool = () => {
  answerPoolPromise ??= fetchWordTexts('answers').then(buildAnswerPool).catch((err) => {
    answerPoolPromise = null;
    throw err;
  });
  return answerPoolPromise;
};

// ── 데일리 퍼즐 로딩(캐시) ──
const puzzleCache = new Map();
async function loadDailyPuzzle(date) {
  if (puzzleCache.has(date)) return puzzleCache.get(date);
  const res = await fetch(`daily/${date}.json`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${date} 퍼즐을 찾을 수 없음`);
  const data = await res.json();
  const puzzle = { onsets: [...data.onsets], ships: data.ships };
  puzzleCache.set(date, puzzle);
  return puzzle;
}

// ── 게임 세션 ──
/** @type {{ kind: 'daily'|'archive'|'free', date: string, puzzle: object, guesses: object[], map: object[] } | null} */
let session = null;
let state = null;
let selection = null;
let viewingAnswer = false;
let resultShown = false;

const renderer = new BoardRenderer(boardEl, { onSelect: handleSelect });

// 보드 가장자리 좌표 라벨 (a~h, 1~8)
document.querySelector('.ws-col-labels').append(...Array.from({ length: SIZE }, (_, c) => {
  const s = document.createElement('span'); s.textContent = String.fromCharCode(97 + c); return s;
}));
document.querySelector('.ws-row-labels').append(...Array.from({ length: SIZE }, (_, r) => {
  const s = document.createElement('span'); s.textContent = String(r + 1); return s;
}));

function sessionTitle() {
  if (session.kind === 'free') return '데일리 워십 · 자유 연습';
  return `데일리 워십 · ${session.date}`;
}

function persist() {
  if (session?.kind !== 'daily') return;
  saveProgress({
    date: session.date,
    onsets: session.puzzle.onsets.join(''),
    guesses: session.guesses,
    status: state.status === 'won' ? 'solved' : state.status === 'lost' ? 'failed' : 'playing',
  });
}

function openGame(newSession) {
  session = { ...newSession, map: shipMap(newSession.puzzle) };
  resultShown = false;
  viewingAnswer = false;
  selection = null;
  renderer.setSelection(null, { silent: true });
  wordInput.value = '';
  setMessage('');
  showGame();
  renderGame();
  // 이미 끝난 판(오늘 데일리를 다시 연 경우)이면 결과창을 다시 띄우지는 않는다
  if (state.status !== 'playing') resultShown = true;
}

function renderGame() {
  state = computeState(session.puzzle, session.guesses);
  const playing = state.status === 'playing';
  const doneShips = session.puzzle.ships.filter((_, s) => state.completed[s]);
  const doneCells = new Set(doneShips.flatMap((s) => boxCells(s)));
  renderer.render({
    onsets: session.puzzle.onsets,
    revealed: state.revealed,
    hit: state.hit,
    miss: state.miss,
    doneCells,
    doneShips,
    answerShips: viewingAnswer ? session.puzzle.ships.filter((_, s) => !state.completed[s]) : [],
    interactive: playing,
  });

  guessesLeftEl.textContent = String(MAX_GUESSES - state.results.length);
  guessesMaxEl.textContent = `/ ${MAX_GUESSES}`;
  guessesLeftEl.parentElement.classList.toggle('is-low', playing && MAX_GUESSES - state.results.length <= 3);
  modeLabelEl.textContent = session.kind === 'free' ? '자유 연습' : session.kind === 'archive' ? `${session.date} · 지난 퍼즐` : session.date;

  renderFleet();
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

function renderHistory() {
  historyEl.replaceChildren(...session.guesses.map((g, n) => {
    const li = document.createElement('li');
    li.className = 'ws-history-item';
    const num = document.createElement('span');
    num.className = 'ws-history-num';
    num.textContent = String(n + 1);
    const where = document.createElement('span');
    where.className = 'ws-history-where';
    where.textContent = boxLabel(g);
    const word = document.createElement('span');
    word.className = 'ws-history-word';
    const outcomes = cellOutcomes(session.puzzle, g, session.map);
    [...g.word].forEach((ch, k) => {
      const b = document.createElement('b');
      b.className = `ws-chip ws-chip--${outcomes[k]}`;
      b.textContent = ch;
      word.appendChild(b);
    });
    li.append(num, word, where);
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
  wordInput.disabled = !box;
  btnSubmit.disabled = !box;
  if (box) {
    wordInput.placeholder = `${boxCells(box).map((i) => session.puzzle.onsets[i]).join(' ')} — ${box.len}글자 명사`;
    wordInput.focus({ preventScroll: true });
  } else {
    wordInput.placeholder = '';
  }
  renderSlots();
}

function renderSlots() {
  slotsEl.replaceChildren();
  if (!selection || !state || state.status !== 'playing') return;
  const cells = boxCells(selection);
  const typed = [...wordInput.value.replace(/\s+/g, '')];
  cells.forEach((idx, i) => {
    const slot = document.createElement('span');
    slot.className = 'ws-slot';
    const want = session.puzzle.onsets[idx];
    const ch = typed[i];
    if (ch) {
      slot.textContent = ch;
      const on = onsetOf(ch);
      if (on) slot.classList.add(on === want ? 'is-ok' : 'is-bad');
    } else {
      slot.textContent = want;
      slot.classList.add('is-empty');
    }
    slotsEl.appendChild(slot);
  });
  if (typed.length > cells.length) slotsEl.lastChild.classList.add('is-bad');
}
wordInput.addEventListener('input', renderSlots);

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
  setMessage('');
  if (state.status !== 'playing' && !resultShown) {
    resultShown = true;
    wordInput.blur();
    if (session.kind === 'daily') {
      recordResult(session.date, state.status === 'won' ? 'solved' : 'failed', state.status === 'won' ? state.results.length : null);
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

// ── 정답 보기 · 새 퍼즐 ──
btnViewAnswer.addEventListener('click', () => { viewingAnswer = !viewingAnswer; renderGame(); });
btnNewFree.addEventListener('click', () => startFreePlay());

// ── 결과 모달 ──
function showResultModal() {
  const won = state.status === 'won';
  dailyResultTitle.textContent = won ? '🎉 함대 격파!' : '아쉬워요';
  const shipCount = session.puzzle.ships.length;
  dailyResultDetail.textContent = session.kind === 'daily'
    ? `${session.date} · ${buildSummaryLine(state, shipCount)}`
    : `${session.kind === 'free' ? '자유 연습' : `${session.date} 지난 퍼즐`} · ${buildSummaryLine(state, shipCount)} (기록에는 반영되지 않아요)`;
  dailyResultGrid.textContent = buildGuessEmojiGrid(state.results);
  dailyShareNote.textContent = '';
  openPanel(dailyResultModal);
}
btnDailyResultClose.addEventListener('click', () => closePanel(dailyResultModal));
dailyResultModal.addEventListener('click', (e) => { if (e.target === dailyResultModal) closePanel(dailyResultModal); });
btnDailyResultStats.addEventListener('click', () => { closePanel(dailyResultModal); openStatsModal(); });
btnDailyResultShare.addEventListener('click', async () => {
  const text = buildShareText({ title: sessionTitle(), state, shipCount: session.puzzle.ships.length, url: SITE_URL });
  const ok = await copyText(text);
  dailyShareNote.textContent = ok ? '클립보드에 복사했어요!' : '복사에 실패했어요.';
});

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

// ── 오늘의 퍼즐 ──
btnDailyPlay.addEventListener('click', async () => {
  const date = TODAY();
  dailyLoadNote.hidden = false;
  dailyErrorEl.textContent = '';
  try {
    const puzzle = await loadDailyPuzzle(date);
    const saved = loadProgress(date);
    const guesses = saved && saved.onsets === puzzle.onsets.join('') ? saved.guesses : [];
    openGame({ kind: 'daily', date, puzzle, guesses: [...guesses] });
    persist();
  } catch (err) {
    dailyErrorEl.textContent = '퍼즐을 불러오지 못했어요. 잠시 후 다시 시도해주세요.';
    console.error(err);
  } finally {
    dailyLoadNote.hidden = true;
  }
});

function refreshLandingCard() {
  landingDate.textContent = TODAY();
  const today = summarize(TODAY()).results[TODAY()];
  if (today?.status === 'solved') { dailyCardStatus.textContent = '성공'; dailyCardStatus.dataset.status = 'solved'; }
  else if (today?.status === 'failed') { dailyCardStatus.textContent = '실패'; dailyCardStatus.dataset.status = 'timeout'; }
  else {
    const p = loadProgress(TODAY());
    if (p && p.guesses?.length) { dailyCardStatus.textContent = `진행 중 · ${p.guesses.length}/${MAX_GUESSES}`; dailyCardStatus.dataset.status = 'playing'; }
    else { dailyCardStatus.textContent = '플레이 전'; dailyCardStatus.dataset.status = 'new'; }
  }
}

// ── 자유 연습 — 브라우저에서 즉석 생성 ──
async function startFreePlay() {
  try {
    const [pool, { generatePuzzle }] = await Promise.all([loadAnswerPool(), import('./game/generator.js')]);
    const puzzle = generatePuzzle(`free:${Date.now()}:${Math.random()}`, pool);
    openGame({ kind: 'free', date: '자유 연습', puzzle, guesses: [] });
  } catch (err) {
    dailyErrorEl.textContent = '자유 연습 퍼즐을 만들지 못했어요.';
    console.error(err);
    showLanding();
  }
}
btnFreePlay.addEventListener('click', startFreePlay);

btnGoLanding.addEventListener('click', showLanding);

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
      if (r) cell.classList.add('cal-cell--filled', r.status === 'solved' ? 'cal-cell--solved' : 'cal-cell--fail');
      else if (dateStr > today) cell.classList.add('cal-cell--future');
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
const archiveCal = makeCalendar({
  gridEl: archiveCalEl, titleEl: archiveCalTitle, prevEl: archiveCalPrev, nextEl: archiveCalNext,
  pick: true,
  onPick: (d) => { archiveSelected = d; btnArchivePlay.disabled = false; archiveErrorEl.textContent = ''; },
});

btnArchive.addEventListener('click', () => {
  landingMain.hidden = true;
  landingArchive.hidden = false;
  archiveSelected = null;
  btnArchivePlay.disabled = true;
  archiveErrorEl.textContent = TODAY() <= DAILY_FIRST_DATE ? '아직 지난 퍼즐이 없어요 — 내일부터 열려요.' : '';
  archiveCal.open(summarize(TODAY()), { minDate: DAILY_FIRST_DATE, maxDate: shiftDateStr(TODAY(), -1) });
});
archiveBack.addEventListener('click', () => { landingArchive.hidden = true; landingMain.hidden = false; });

btnArchivePlay.addEventListener('click', async () => {
  if (!archiveSelected) return;
  try {
    const puzzle = await loadDailyPuzzle(archiveSelected);
    openGame({ kind: 'archive', date: archiveSelected, puzzle, guesses: [] });
  } catch (err) {
    archiveErrorEl.textContent = '그 날짜의 퍼즐을 불러오지 못했어요.';
    console.error(err);
  }
});

// ── 통계 모달 ──
const statsCal = makeCalendar({ gridEl: dailyStatsCal, titleEl: dailyCalTitle, prevEl: dailyCalPrev, nextEl: dailyCalNext });
let statsCountdownTimer = null;

function openStatsModal() {
  const s = summarize(TODAY());
  statPlayed.textContent = s.played;
  statWinRate.textContent = s.winRate;
  statStreak.textContent = s.curStreak;
  statMaxStreak.textContent = s.maxStreak;
  statsCal.open(s, { minDate: DAILY_FIRST_DATE });

  dailyStatsDist.innerHTML = '';
  const max = Math.max(1, ...s.distribution);
  DIST_BUCKETS.forEach((label, i) => {
    const count = s.distribution[i];
    const row = document.createElement('div');
    row.className = 'ws-dist-row';
    row.innerHTML = `<span class="ws-dist-label">${label}</span>
      <span class="ws-dist-track"><span class="ws-dist-fill${i === DIST_BUCKETS.length - 1 ? ' is-fail' : ''}" style="width:${(count / max) * 100}%"></span></span>
      <span class="ws-dist-count">${count}</span>`;
    dailyStatsDist.appendChild(row);
  });
  dailyStatsShareNote.textContent = '';
  calShareNote.textContent = '';

  openPanel(dailyStatsModal);
  clearInterval(statsCountdownTimer);
  const tick = () => { dailyNextCountdown.textContent = formatCountdown(msUntilNextReset()); };
  tick();
  statsCountdownTimer = setInterval(tick, 1000);
}
function closeStatsModal() { closePanel(dailyStatsModal); clearInterval(statsCountdownTimer); }
dailyStatsClose.addEventListener('click', closeStatsModal);
dailyStatsModal.addEventListener('click', (e) => { if (e.target === dailyStatsModal) closeStatsModal(); });
btnLandingStats.addEventListener('click', openStatsModal);
btnGameStats.addEventListener('click', openStatsModal);

btnCalShare.addEventListener('click', async () => {
  const { y, m } = statsCal.monthYM();
  const text = buildCalendarShareText({ results: summarize(TODAY()).results, year: y, month: m, url: SITE_URL });
  calShareNote.textContent = (await copyText(text)) ? '복사했어요!' : '복사 실패';
});
btnDailyStatsShare.addEventListener('click', async () => {
  const p = loadProgress(TODAY());
  if (!p || p.status === 'playing') { dailyStatsShareNote.textContent = '오늘 퍼즐을 먼저 풀어주세요.'; return; }
  const puzzle = await loadDailyPuzzle(TODAY());
  const st = computeState(puzzle, p.guesses);
  const text = buildShareText({ title: `데일리 워십 · ${TODAY()}`, state: st, shipCount: puzzle.ships.length, url: SITE_URL });
  dailyStatsShareNote.textContent = (await copyText(text)) ? '복사했어요!' : '복사 실패';
});

// ── 도움말 ──
function openHelpModal() { openPanel(gameHelpModal); }
gameHelpClose.addEventListener('click', () => closePanel(gameHelpModal));
gameHelpModal.addEventListener('click', (e) => { if (e.target === gameHelpModal) closePanel(gameHelpModal); });
btnGameHelp.addEventListener('click', openHelpModal);
btnLandingHelp.addEventListener('click', openHelpModal);

// ── 다크 모드 ──
const DARK_MODE_KEY = 'wordship-dark-mode';
btnLandingDark.addEventListener('click', () => {
  const on = document.documentElement.getAttribute('data-theme') !== 'dark';
  document.documentElement.setAttribute('data-theme', on ? 'dark' : 'light');
  try { localStorage.setItem(DARK_MODE_KEY, on ? '1' : '0'); } catch { /* 무시 */ }
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
