/**
 * test-e2e.mjs — 실제 브라우저(Playwright)로 랜딩 → 데일리 → 드래그·입력·제출 → 치트 → 결과 → 새로고침 복원까지.
 * `npm install` 후 `npx playwright install chromium` 한 번 해두면 됨.
 *
 *   node scripts/test-e2e.mjs [스크린샷 폴더]
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startServer } from './dev-server.mjs';
import { dateStrKST } from '../src/daily/dateUtil.js';
import { boardOf } from '../src/game/board.js';
import { MAX_GUESSES, parsePuzzle, guessRules, boxProblem } from '../src/game/game.js';
import { GIMMICKS, gimmickLine } from '../src/game/gimmicks.js';
import { MODES } from '../src/game/modes.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOT_DIR = process.argv[2];

function assert(name, cond) {
  console.log(cond ? `✅ ${name}` : `❌ ${name}`);
  if (!cond) process.exitCode = 1;
}

const today = dateStrKST();
const puzzle = JSON.parse(readFileSync(path.join(ROOT, 'daily', `${today}.json`), 'utf8'));
const ext = JSON.parse(readFileSync(path.join(ROOT, 'daily', `extended-${today}.json`), 'utf8'));
const extGeo = boardOf(ext.size);
const extPuzzle = parsePuzzle(ext);
const server = await startServer(0);
const base = `http://localhost:${server.address().port}`;
const consoleErrors = [];

async function dragBox(page, box, geo = boardOf(8)) {
  const cells = geo.boxCells(box);
  const a = await page.locator('.ws-cell').nth(cells[0]).boundingBox();
  const b = await page.locator('.ws-cell').nth(cells[cells.length - 1]).boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
}

const browser = await chromium.launch();
try {
  for (const viewport of [{ width: 390, height: 844, name: 'phone' }, { width: 1280, height: 800, name: 'desktop' }]) {
    console.log(`── ${viewport.name} ${viewport.width}×${viewport.height}`);
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

    await page.goto(`${base}/index.html`);
    await page.waitForSelector('.landing-title');
    assert('첫 방문 → 게임 방법 모달', await page.locator('#game-help-modal.show').count() === 1);
    if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, `${viewport.name}-0-help.png`) });
    await page.click('#game-help-close');
    if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, `${viewport.name}-1-landing.png`) });

    await page.click('#btn-daily-play');
    await page.waitForSelector('.ws-cell');
    assert('칸 64개', await page.locator('.ws-cell').count() === 64);
    const firstOnset = await page.locator('.ws-tile-main').first().textContent();
    assert('초성 표시', firstOnset === puzzle.onsets[0]);

    // 4칸 함선을 드래그해서 정답 입력
    const ship = puzzle.ships[0];
    await dragBox(page, ship);
    assert('드래그 → 칸 선택', await page.locator('.ws-tile.is-selected').count() === ship.len);
    assert('입력창 활성', await page.locator('#ws-word-input').isEnabled());

    // 초성 안 맞는 단어는 거절 (횟수 그대로)
    await page.fill('#ws-word-input', '가'.repeat(ship.len));
    await page.press('#ws-word-input', 'Enter');
    await page.waitForTimeout(300);
    const msg = await page.textContent('#ws-message');
    assert(`잘못된 입력 거절 ("${msg}")`, msg.includes('초성') || msg.includes('사전'));
    assert(`횟수 그대로 ${MAX_GUESSES}`, (await page.textContent('#ws-guesses-left')) === String(MAX_GUESSES));

    await page.fill('#ws-word-input', ship.name);
    await page.press('#ws-word-input', 'Enter');
    await page.waitForFunction(() => document.querySelectorAll('.ws-tile.is-done').length > 0, null, { timeout: 15000 });
    assert(`함선 완성 → 초록 ${ship.len}칸`, await page.locator('.ws-tile.is-done').count() === ship.len);
    assert(`남은 추측 ${MAX_GUESSES - 1}`, (await page.textContent('#ws-guesses-left')) === String(MAX_GUESSES - 1));
    assert('기록 1줄', await page.locator('.ws-history-item').count() === 1);
    assert('함대 현황 1척 완성', await page.locator('.ws-fleet-ship.is-done').count() === 1);

    // 빈 바다를 한 번 찍어 보기 — 대각선 드래그
    await dragBox(page, { r: 0, c: 0, dir: 'd', len: 2 });
    const sel = await page.locator('.ws-tile.is-selected').count();
    assert('대각선 드래그 선택', sel === 2);
    if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, `${viewport.name}-2-selected.png`) });
    await page.click('#ws-word-input');
    await page.keyboard.type('a바1 다!?');
    assert('한글 외 문자는 바로 지움', (await page.inputValue('#ws-word-input')) === '바다');
    await page.fill('#ws-word-input', '아무');
    await page.keyboard.press('Escape');
    assert('선택 취소 → 입력칸 비움', (await page.inputValue('#ws-word-input')) === '');

    // 새로고침 → 진행 복원
    await page.reload();
    await page.click('#btn-daily-play');
    await page.waitForSelector('.ws-cell');
    assert('새로고침 후 진행 복원', await page.locator('.ws-tile.is-done').count() === ship.len);

    await page.evaluate(() => window.__solve());
    await page.waitForSelector('#daily-result-modal.show', { timeout: 3000 });
    assert('치트 → 결과 모달', true);
    assert('모든 함선 초록', await page.locator('.ws-tile.is-done').count() === puzzle.ships.reduce((a, s) => a + s.len, 0));
    if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, `${viewport.name}-3-result.png`) });
    await page.click('#btn-daily-result-close');
    if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, `${viewport.name}-4-solved.png`) });

    await page.click('#btn-go-landing');
    assert('랜딩 카드 = 성공', (await page.textContent('#daily-card-status')) === '성공');
    await page.click('#btn-landing-stats');
    assert('통계 — 1게임', (await page.textContent('#stat-played')) === '1');
    if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, `${viewport.name}-5-stats.png`) });
    await page.click('#daily-stats-close');

    // 자유 연습 — 모드 선택 창
    await page.click('#btn-free-play');
    await page.click('#freeplay-mode-modal .daily-card[data-mode="standard"]');
    await page.waitForSelector('.ws-cell');
    assert('자유 연습 퍼즐 생성', (await page.textContent('#ws-mode-label')) === '스탠다드 · 자유 연습');
    await page.evaluate(() => window.__solve());
    await page.waitForSelector('#daily-result-modal.show', { timeout: 3000 });
    await page.click('#btn-daily-result-close');
    assert('자유 연습 끝 → 새 퍼즐 버튼', await page.locator('#btn-new-free').isVisible());

    // 사자성어 데일리
    await page.click('#btn-go-landing');
    await page.click('#btn-daily-play-idiom');
    await page.waitForSelector('.ws-cell');
    assert('사자성어 — 함선 5척', await page.locator('.ws-fleet-ship').count() === 5);
    assert('사자성어 — 라벨', (await page.textContent('#ws-mode-label')).startsWith('사자성어 · '));
    await page.evaluate(() => window.__solve());
    await page.waitForSelector('#daily-result-modal.show', { timeout: 3000 });
    assert('사자성어 — 결과 모달', (await page.textContent('#daily-result-detail')).startsWith('사자성어'));
    await page.click('#btn-daily-result-close');
    await page.click('#btn-go-landing');
    assert('사자성어 카드 = 성공', (await page.textContent('#daily-card-status-idiom')) === '성공');
    await page.click('#btn-landing-stats');
    await page.click('#daily-stats-modal .daily-stats-tab[data-mode="idiom"]');
    assert('통계 사자성어 탭 — 1게임', (await page.textContent('#stat-played')) === '1');
    await page.click('#daily-stats-close');
    // 자유 연습 사자성어
    await page.click('#btn-free-play');
    await page.click('#freeplay-mode-modal .daily-card[data-mode="idiom"]');
    await page.waitForSelector('.ws-cell');
    assert('사자성어 자유 연습 — 5척', await page.locator('.ws-fleet-ship').count() === 5);

    // 익스텐디드 데일리 — 그날의 기믹 (오늘: ${ext.gimmicks})
    await page.click('#btn-go-landing');
    await page.waitForFunction((label) => document.getElementById('daily-card-desc-extended').textContent.includes(label), GIMMICKS[ext.gimmicks[0]].label, { timeout: 5000 });
    assert('익스텐디드 카드에 오늘의 기믹 이름', true);
    await page.click('#btn-daily-play-extended');
    await page.waitForSelector('.ws-gimmick');
    assert(`익스텐디드 — 칸 ${extGeo.cellCount}개`, await page.locator('.ws-cell').count() === extGeo.cellCount);
    assert('익스텐디드 — 기믹 칩 2개', await page.locator('.ws-gimmick').count() === 2);
    assert(`익스텐디드 — 남은 추측 ${MODES.extended.maxGuesses}`, (await page.textContent('#ws-guesses-left')) === String(MODES.extended.maxGuesses));
    assert(`잠긴 칸 ${ext.locked.length}개`, await page.locator('.ws-tile.is-hidden').count() === ext.locked.length);
    assert(`구멍 ${extPuzzle.holes.length}개`, await page.locator('.ws-tile.is-hole').count() === extPuzzle.holes.length);
    assert(`함대 ${ext.ships.length}척`, await page.locator('.ws-fleet-ship').count() === ext.ships.length);
    const s0 = ext.ships[0];
    const s0cells = extGeo.boxCells(s0);
    await dragBox(page, s0, extGeo);
    await page.fill('#ws-word-input', s0.name);
    await page.press('#ws-word-input', 'Enter');
    await page.waitForFunction(() => document.querySelectorAll('.ws-tile.is-done').length > 0, null, { timeout: 15000 });
    assert('익스텐디드 — 함선 완성 (잠긴 칸이 섞여도 함명 그대로 통과)', await page.locator('.ws-tile.is-done').count() === s0.len);
    assert('함선 완성 → 기록에 초록 줄', await page.locator('.ws-history-item.is-sunk').count() === 1
      && await page.locator('.ws-history-item.is-sunk .ws-chip--done').count() === s0.len);
    if (ext.gimmicks.includes('costly')) {
      assert('비싼 추측 — 완성하면 +1 (남은 추측 그대로)', (await page.textContent('#ws-guesses-left')) === String(MODES.extended.maxGuesses)
        && (await page.textContent('.ws-history-cost')) === '+1');
    }
    const unlocked = s0cells.filter((i) => ext.locked.includes(i)).length;
    assert(`추측에 포함된 잠긴 칸 ${unlocked}개는 풀림`, await page.locator('.ws-tile.is-hidden').count() === ext.locked.length - unlocked);
    // 직전 추측으로 생긴 제약 — 빗금 칸 수, 그리고 막힌 자리를 고르면 바로 안내 (오늘 기믹이 막는 게 있을 때만)
    const done = [{ ...s0, word: s0.name }];
    const rules = guessRules(extPuzzle, done);
    const blockedN = rules.blocked.filter((r, i) => r && !rules.holes[i]).length;
    assert(`못 쓰는 칸 빗금 ${blockedN}개`, await page.locator('.ws-tile.is-blocked').count() === blockedN);
    const bad = [4, 3, 2].flatMap((len) => extGeo.allBoxes(len)).find((b) => boxProblem(extPuzzle, done, b, rules));
    if (bad) {
      const want = boxProblem(extPuzzle, done, bad, rules);
      await dragBox(page, bad, extGeo);
      const m = await page.textContent('#ws-message');
      assert(`막힌 자리 → 바로 안내 ("${m}")`, m === want && await page.locator('#ws-word-input').isDisabled());
      await page.keyboard.press('Escape');
    }
    await page.click('.ws-gimmick >> nth=0');
    assert('기믹 칩 → 설명', (await page.textContent('#ws-message')).includes(GIMMICKS[ext.gimmicks[0]].help.slice(0, 10)));
    if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, `${viewport.name}-7-extended.png`) });
    await page.evaluate(() => window.__solve());
    await page.waitForSelector('#daily-result-modal.show', { timeout: 3000 });
    const detail = await page.textContent('#daily-result-detail');
    assert('익스텐디드 — 결과에 기믹 표시', detail.startsWith('익스텐디드') && detail.includes(gimmickLine(ext.gimmicks)));
    await page.click('#btn-daily-result-close');
    await page.click('#btn-go-landing');
    assert('익스텐디드 카드 = 성공', (await page.textContent('#daily-card-status-extended')) === '성공');
    await page.click('#btn-landing-stats');
    await page.click('#daily-stats-modal .daily-stats-tab[data-mode="extended"]');
    assert('통계 익스텐디드 탭 — 1게임', (await page.textContent('#stat-played')) === '1');
    assert('통계 익스텐디드 — 분포 첫 구간 1~15번', (await page.locator('.ws-dist-label').first().textContent()) === '1~15번');
    await page.click('#daily-stats-close');

    // 익스텐디드 자유 연습 — 넓은 바다(10×10) + 잠긴 칸
    await page.evaluate(() => window.__freePlay('extended', ['wide', 'fog']));
    await page.waitForFunction(() => document.querySelectorAll('.ws-cell').length === 100);
    assert('넓은 바다 — 10×10 · 좌표 j·10', (await page.locator('.ws-col-labels span').last().textContent()) === 'j'
      && (await page.locator('.ws-row-labels span').last().textContent()) === '10');
    assert('잠긴 칸 17개 (100칸의 1/6)', await page.locator('.ws-tile.is-hidden').count() === 17);
    await dragBox(page, { r: 9, c: 6, dir: 'h', len: 4 }, boardOf(10));
    assert('10×10 드래그 — 오른쪽 아래 4칸', await page.locator('.ws-tile.is-selected').count() === 4);
    const cellW = await page.locator('.ws-cell').first().evaluate((e) => e.getBoundingClientRect().width);
    const boardW = await page.locator('#ws-board').evaluate((e) => e.getBoundingClientRect().width);
    assert('10×10 — 칸 폭 = 판 폭 / 10', Math.abs(cellW * 10 - boardW) < 1);
    if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, `${viewport.name}-8-wide.png`) });

    // 도넛 바다(12×12, 가운데 4×4 구멍) · 좁은 바다(7×7)
    await page.evaluate(() => window.__freePlay('extended', ['donut', 'checkpoint']));
    await page.waitForFunction(() => document.querySelectorAll('.ws-cell').length === 144);
    assert('도넛 바다 — 12×12 · 좌표 l·12 · 구멍 16칸', (await page.locator('.ws-col-labels span').last().textContent()) === 'l'
      && (await page.locator('.ws-row-labels span').last().textContent()) === '12' && await page.locator('.ws-tile.is-hole').count() === 16);
    await dragBox(page, { r: 3, c: 3, dir: 'd', len: 3 }, boardOf(12));
    assert('도넛 바다 — 구멍을 지나는 박스는 바로 안내', (await page.textContent('#ws-message')).includes('구멍'));
    await page.keyboard.press('Escape');
    assert('관문 칩 — 10번째 격침 필수', (await page.textContent('.ws-gimmick[data-gimmick="checkpoint"] small')).startsWith('10번째'));
    if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, `${viewport.name}-9-donut.png`) });
    await page.evaluate(() => window.__freePlay('extended', ['narrow', 'extra4']));
    await page.waitForFunction(() => document.querySelectorAll('.ws-cell').length === 49);
    assert('좁은 바다 — 7×7 · 함선 7척', await page.locator('.ws-fleet-ship').count() === 7);

    // 다크 모드 (스탠다드로 돌아오면 다시 8×8)
    await page.click('#btn-go-landing');
    await page.click('#btn-landing-dark');
    await page.click('#btn-daily-play');
    await page.waitForSelector('.ws-cell');
    assert('스탠다드로 돌아오면 칸 64개', await page.locator('.ws-cell').count() === 64);
    if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, `${viewport.name}-6-dark.png`) });
    await context.close();
  }
  assert(`콘솔 에러 없음 (${consoleErrors.length}개)`, consoleErrors.length === 0);
  if (consoleErrors.length) console.log(consoleErrors.join('\n'));
} finally {
  await browser.close();
  server.close();
}
