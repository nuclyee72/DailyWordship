/**
 * word-origin.mjs — 표준국어대사전의 원어(origin)로 단어 어종을 판별한다. 출제 풀에서 외래어를 빼는 데 쓴다.
 *
 * 캐시: scripts/data/word-origin.json  { 단어: [명사 뜻별 원어, ...] }  (사전에 없는 단어는 [])
 *   - 새 단어만 오픈 API로 조회해 캐시에 더한다. 키는 환경변수 STDICT_KEY 또는 상위 폴더의 .env (git에 안 올라감)
 *   - 키가 없으면 조회를 건너뛰고(경고) 캐시에 없는 단어는 판별하지 않는다(= 출제 풀에 남는다)
 *   - 표준국어대사전 오픈 API: https://stdict.korean.go.kr/openapi/openApiInfo.do (하루 50,000건)
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = path.join(HERE, '..', 'data', 'word-origin.json');

export function loadOriginCache() {
  return existsSync(CACHE_PATH) ? JSON.parse(readFileSync(CACHE_PATH, 'utf8')) : {};
}

function saveOriginCache(cache) {
  mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  const sortedCache = Object.fromEntries(Object.keys(cache).sort((a, b) => a.localeCompare(b, 'ko')).map((k) => [k, cache[k]]));
  writeFileSync(CACHE_PATH, JSON.stringify(sortedCache, null, 0).replace(/\],"/g, '],\n"') + '\n');
}

function stdictKey() {
  if (process.env.STDICT_KEY) return process.env.STDICT_KEY.trim();
  for (const dir of [path.join(HERE, '..', '..'), path.join(HERE, '..', '..', '..')]) {
    const env = path.join(dir, '.env');
    if (!existsSync(env)) continue;
    const m = readFileSync(env, 'utf8').match(/^STDICT_KEY=(.*)$/m);
    if (m) return m[1].trim().replace(/^"|"$/g, '');
  }
  return '';
}

const NOUNISH = new Set(['명사', '대명사', '품사 없음']);

async function lookup(key, word) {
  const url = `https://stdict.korean.go.kr/api/search.do?key=${key}&q=${encodeURIComponent(word)}&req_type=json&num=100`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const text = await (await fetch(url)).text();
      if (!text.trim()) return []; // 결과 없음은 빈 응답
      const j = JSON.parse(text);
      if (j.error) throw new Error(`표준국어대사전 API 오류 ${j.error.error_code}: ${j.error.message}`);
      const items = (j.channel?.item ?? []).filter((i) => i.word.replace(/[-^ ]/g, '') === word);
      const nouns = items.filter((i) => NOUNISH.has(i.pos));
      return (nouns.length ? nouns : items).map((i) => i.origin || '');
    } catch (err) {
      if (String(err.message).startsWith('표준국어대사전 API 오류')) throw err;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  return null; // 네트워크 실패 — 다음 빌드에서 다시
}

/** 캐시에 없는 단어를 조회해 캐시에 더한다 */
export async function lookupMissing(cache, words) {
  const missing = [...new Set(words)].filter((w) => !(w in cache));
  if (!missing.length) return cache;
  const key = stdictKey();
  if (!key) {
    console.warn(`⚠ STDICT_KEY 없음 — 원어를 모르는 단어 ${missing.length}개는 외래어 판별 없이 출제 풀에 남습니다`);
    return cache;
  }
  console.log(`표준국어대사전에서 원어 조회: ${missing.length}개`);
  const queue = [...missing];
  let failed = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const w = queue.shift();
      const r = await lookup(key, w);
      if (r === null) failed++; else cache[w] = r;
    }
  }));
  if (failed) console.warn(`⚠ 원어 조회 실패 ${failed}개 — 다음 빌드에서 다시 조회`);
  saveOriginCache(cache);
  return cache;
}

// ── 판별 ──
const LATIN = /[A-Za-zÀ-ÿ]/;
const HAN = /[㐀-鿿豈-﫿]/;
const HANGUL = /[가-힣ㄱ-ㅎ]/;

/** 뜻 하나의 원어 → 'loan'(외래어) · 'mixed-loan'(외래어 섞인 혼종어) · 'sino'(한자어) · 'mixed'(한자+고유) · 'native' */
export function originType(raw) {
  // 사전이 특수 한자를 <span>&#x9396;</span>로 보냄 · ←(변한 말) · [玉](일본어 원어의 한자 병기)는 판별에서 뺀다
  const origin = (raw || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[←\s/·-]/g, '');
  if (!origin) return 'native';
  const latin = LATIN.test(origin), han = HAN.test(origin), hangul = HANGUL.test(origin);
  if (latin && !han && !hangul) return 'loan';
  if (latin) return 'mixed-loan';
  if (han && hangul) return 'mixed';
  if (han) return 'sino';
  return 'native';
}

/**
 * 단어 전체의 어종 — 'unknown'(캐시·사전에 없음) · 'ambiguous'(외래어 뜻 + 다른 뜻이 같이 있음, 예: 기타·소파)
 * · 'loan' · 'mixed-loan' · 'mixed' · 'sino' · 'native'
 */
export function wordType(cache, word) {
  const origins = cache[word];
  if (!origins || !origins.length) return 'unknown';
  const types = new Set(origins.map(originType));
  const hasLoan = types.has('loan') || types.has('mixed-loan');
  const hasOther = types.has('sino') || types.has('native') || types.has('mixed');
  if (hasLoan && hasOther) return 'ambiguous';
  for (const t of ['loan', 'mixed-loan', 'mixed', 'sino']) if (types.has(t)) return t;
  return 'native';
}
