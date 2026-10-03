/**
 * generate-daily.mjs — 그 날의 퍼즐을 모드별로 생성해 저장.
 *   스탠다드 → daily/<date>.json · 익스텐디드 → daily/extended-<date>.json · 사자성어 → daily/idiom-<date>.json
 *   (src/game/modes.js). 익스텐디드는 그날의 기믹 2개(src/game/gimmicks.js)와 판 크기·잠긴 칸도 같이 담는다.
 * (DailyTrilateral/scripts/generate-daily.mjs와 같은 패턴 — 멱등, 며칠치 버퍼, GitHub Actions 크론이 호출)
 *
 *   node scripts/generate-daily.mjs                # KST 오늘 + 앞으로 3일 (버퍼)
 *   node scripts/generate-daily.mjs 2026-09-24     # 특정 날짜
 *   node scripts/generate-daily.mjs 2026-09-24 30  # 2026-09-24부터 30일치
 *   스탠다드·익스텐디드는 그날의 주제(src/game/themes.js)를 골라 함명을 그 주제 단어로 뽑고 theme·themeShips에 담는다.
 *
 * 이미 파일이 있으면 건너뛴다(멱등) — 단어 데이터가 나중에 바뀌어도 이미 커밋된 날짜의 퍼즐은
 * 절대 안 바뀌어야 하기 때문(지난 퍼즐 아카이브가 그 날 그 퍼즐을 그대로 다시 보여줘야 함).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { generatePuzzle } from '../src/game/generator.js';
import { dateStrKST, shiftDateStr } from '../src/daily/dateUtil.js';
import { loadAnswerPool, loadThemeWords } from './lib/words.mjs';
import { MODES } from '../src/game/modes.js';
import { dailyGimmicks } from '../src/game/gimmicks.js';
import { dailyTheme } from '../src/game/themes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DAILY_DIR = path.join(__dirname, '..', 'daily');
const pools = Object.fromEntries(Object.keys(MODES).map((id) => [id, loadAnswerPool(id)]));
const themeWords = loadThemeWords();

async function generateForDate(dateStr, mode) {
  const fileName = mode.fileName(dateStr);
  const outPath = path.join(DAILY_DIR, `${fileName}.json`);
  if (existsSync(outPath)) {
    console.log(`· ${fileName} 이미 있음 — 건너뜀`);
    return false;
  }
  const gimmicks = mode.gimmicks ? dailyGimmicks(dateStr) : [];
  const themeId = mode.themed ? dailyTheme(dateStr, mode.id) : null;
  const theme = themeId && { id: themeId, words: themeWords[themeId] };
  const puzzle = generatePuzzle(`${mode.seedPrefix}:${dateStr}`, pools[mode.id], { fleet: mode.fleet, minDecoys: mode.minDecoys, gimmicks, theme });
  // 그 길이의 주제 단어가 모자라 일반 단어로 채운 함선이 있을 수 있어서, 몇 척이 주제 함선인지도 담는다
  const themeShips = theme ? puzzle.ships.filter((s) => theme.words.has(s.name)).length : 0;
  const payload = {
    date: dateStr,
    // 기믹 없는 모드는 예전 파일 형식 그대로 (8×8 · 잠긴 칸 없음)
    ...(gimmicks.length ? { gimmicks, size: puzzle.size, locked: puzzle.locked, holes: puzzle.holes } : {}),
    ...(theme ? { theme: theme.id, themeShips } : {}),
    onsets: puzzle.onsets.join(''),
    ships: puzzle.ships.map(({ len, r, c, dir, name }) => ({ len, r, c, dir, name })),
    generatedAt: new Date().toISOString(),
  };
  await mkdir(DAILY_DIR, { recursive: true });
  await writeFile(outPath, JSON.stringify(payload) + '\n', 'utf8');
  console.log(`✓ ${fileName} 저장 (${payload.ships.map((s) => s.name).join(', ')}${gimmicks.length ? ` · 기믹 ${gimmicks.join('+')}` : ''}${theme ? ` · 주제 ${theme.id} ${themeShips}/${payload.ships.length}척` : ''})`);
  return true;
}

async function main() {
  const [arg1, arg2] = process.argv.slice(2);
  const startDate = arg1 || dateStrKST();
  const count = arg1 ? (Number(arg2) || 1) : 4;

  let wrote = 0;
  for (let i = 0; i < count; i++) {
    const dateStr = shiftDateStr(startDate, i);
    try {
      for (const mode of Object.values(MODES)) if (await generateForDate(dateStr, mode)) wrote++;
    } catch (err) {
      console.error(`✗ ${dateStr} 실패:`, err.message);
      process.exitCode = 1;
    }
  }
  console.log(`완료 — ${wrote}개 새로 생성`);
}

main();
