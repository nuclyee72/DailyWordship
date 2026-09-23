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
import { boxCells } from '../src/game/board.js';
import { MAX_GUESSES } from '../src/game/game.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOT_DIR = process.argv[2];

function assert(name, cond) {
  console.log(cond ? `✅ ${name}` : `❌ ${name}`);
  if (!cond) process.exitCode = 1;
}

const today = dateStrKST();
const puzzle = JSON.parse(readFileSync(path.join(ROOT, 'daily', `${today}.json`), 'utf8'));
const server = await startServer(0);
const base = `http://localhost:${server.address().port}`;
const consoleErrors = [];

async function dragBox(page, box) {
  const cells = boxCells(box);
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

    // 자유 연습
    await page.click('#btn-free-play');
    await page.waitForSelector('.ws-cell');
    assert('자유 연습 퍼즐 생성', (await page.textContent('#ws-mode-label')) === '자유 연습');
    await page.evaluate(() => window.__solve());
    await page.waitForSelector('#daily-result-modal.show', { timeout: 3000 });
    await page.click('#btn-daily-result-close');
    assert('자유 연습 끝 → 새 퍼즐 버튼', await page.locator('#btn-new-free').isVisible());

    // 다크 모드
    await page.click('#btn-go-landing');
    await page.click('#btn-landing-dark');
    await page.click('#btn-daily-play');
    await page.waitForSelector('.ws-cell');
    if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, `${viewport.name}-6-dark.png`) });
    await context.close();
  }
  assert(`콘솔 에러 없음 (${consoleErrors.length}개)`, consoleErrors.length === 0);
  if (consoleErrors.length) console.log(consoleErrors.join('\n'));
} finally {
  await browser.close();
  server.close();
}
