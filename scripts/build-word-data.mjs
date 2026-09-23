/**
 * build-word-data.mjs — 원본 명사 목록을 내려받아 출제 풀(answers)과 추측 사전(guesses)을 만든다.
 *
 *   npm run build-word-data
 *
 * 출처 (자세한 내용은 src/data/README.md)
 *  - han-dle/pd-korean-noun-list-for-wordles (CC0) — CommonNouns(상용 어휘), AllNouns(표준국어대사전 명사)
 *  - open-korean-text/open-korean-text (Apache-2.0) — nouns.txt (일반 명사 사전),
 *    wikipedia_title_nouns.txt (위키백과 표제어 명사 — 합성어·외래어가 많다. 고유명사도 섞여 있지만 추측용이라 괜찮다)
 *  - src/data/curated/*.txt — 손으로 고른 보강 목록·블록리스트
 *
 * 산출물 (src/data/, 한 줄에 한 단어, 가나다순)
 *  - answers-{2,3,4}.txt  함명 출제 풀. 상용 어휘 + 보강 목록 − 블록리스트
 *  - guesses-{2,3,4}.txt  추측 허용 사전. 위 출처 전부 ∪ 출제 풀
 *  - compound-parts.txt   합성어 규칙용 부품 — 상용 명사 1~3글자. "부품 + 부품"인 3~4글자도 추측으로 허용한다
 *                         (라면+집, 택시+비, 교통+카드 …). src/core/dictionary.js 참고
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = {
  common: 'https://raw.githubusercontent.com/han-dle/pd-korean-noun-list-for-wordles/main/src/CommonNouns.js',
  all: 'https://raw.githubusercontent.com/han-dle/pd-korean-noun-list-for-wordles/main/src/AllNouns.js',
  okt: 'https://raw.githubusercontent.com/open-korean-text/open-korean-text/master/src/main/resources/org/openkoreantext/processor/util/noun/nouns.txt',
  oktWiki: 'https://raw.githubusercontent.com/open-korean-text/open-korean-text/master/src/main/resources/org/openkoreantext/processor/util/noun/wikipedia_title_nouns.txt',
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'src', 'data');
const CURATED_DIR = path.join(DATA_DIR, 'curated');
const LENGTHS = [2, 3, 4];

const isWordOfLen = (w, len) => new RegExp(`^[가-힣]{${len}}$`).test(w);

/** `'use strict'; const nouns = [...]; module.exports = nouns;` 형태의 소스를 배열로 평가 */
function parseNounsSource(src) {
  const body = src.replace(/^'use strict';/, '').replace(/module\.exports\s*=\s*nouns;\s*$/, '');
  // eslint-disable-next-line no-new-func -- 원본 저장소는 리터럴 배열만 담고 있어 안전
  return new Function(`${body}\nreturn nouns;`)();
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} 요청 실패: ${res.status}`);
  return res.text();
}

/** '#' 주석·빈 줄을 뺀 단어 목록 */
async function readCurated(name) {
  const text = await readFile(path.join(CURATED_DIR, name), 'utf8');
  return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
}

function checkLengths(name, words, len) {
  const bad = words.filter((w) => !isWordOfLen(w, len));
  if (bad.length) throw new Error(`${name}: ${len}글자 순한글이 아닌 항목 — ${bad.join(', ')}`);
}

const sorted = (set) => [...set].sort((a, b) => a.localeCompare(b, 'ko'));

async function main() {
  console.log('원본 명사 목록 내려받는 중...');
  const [commonSrc, allSrc, oktSrc, oktWikiSrc] = await Promise.all(
    [SRC.common, SRC.all, SRC.okt, SRC.oktWiki].map(fetchText),
  );
  const common = parseNounsSource(commonSrc);
  const all = parseNounsSource(allSrc);
  const okt = oktSrc.split(/\r?\n/).map((l) => l.trim());
  const oktWiki = oktWikiSrc.split(/\r?\n/).map((l) => l.trim());

  const blocklist = new Set(await readCurated('blocklist.txt'));
  const extra3 = await readCurated('answers-3-extra.txt');
  const extra4 = await readCurated('answers-4-extra.txt');
  checkLengths('answers-3-extra.txt', extra3, 3);
  checkLengths('answers-4-extra.txt', extra4, 4);
  const extras = { 2: [], 3: extra3, 4: extra4 };

  for (const len of LENGTHS) {
    const answers = new Set(
      common
        .filter((w) => isWordOfLen(w, len))
        // 3글자 '-적' 관형 명사(간접적·경제적…)는 함명으로 밋밋해서 뺀다 — 추측은 허용
        .filter((w) => !(len === 3 && w.endsWith('적'))),
    );
    for (const w of extras[len]) answers.add(w);
    for (const w of blocklist) answers.delete(w);

    const guesses = new Set([...common, ...all, ...okt, ...oktWiki].filter((w) => isWordOfLen(w, len)));
    for (const w of answers) guesses.add(w);

    await writeFile(path.join(DATA_DIR, `answers-${len}.txt`), sorted(answers).join('\n') + '\n');
    await writeFile(path.join(DATA_DIR, `guesses-${len}.txt`), sorted(guesses).join('\n') + '\n');
    console.log(`${len}글자: 출제 ${answers.size}개 · 추측 허용 ${guesses.size}개`);
  }
  // 합성어 부품: 상용 명사 1~3글자 (블록리스트의 고유명사는 뺀다)
  const parts = new Set(common.filter((w) => /^[가-힣]{1,3}$/.test(w) && !blocklist.has(w)));
  await writeFile(path.join(DATA_DIR, 'compound-parts.txt'), sorted(parts).join('\n') + '\n');
  console.log(`합성어 부품: ${parts.size}개`);
  console.log('저장 완료: src/data/answers-*.txt, src/data/guesses-*.txt, src/data/compound-parts.txt');
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
