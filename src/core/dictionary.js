/**
 * dictionary.js — 출제 풀(answers)과 추측 허용 사전(guesses).
 * 원본은 src/data/{answers,guesses}-{2,3,4}.txt (한 줄에 한 단어, scripts/build-word-data.mjs가 만든다).
 * 브라우저·Node 공용: 텍스트를 넘겨 만들고, 불러오는 쪽(fetch / readFile)은 호출자가 고른다.
 */
import { onsetsOf } from './hangul.js';

export const WORD_LENGTHS = [2, 3, 4];

const parseList = (text) => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

/** 출제 풀 — 생성기가 함명을 고르고 미끼 박스를 셀 때 쓴다 */
export function buildAnswerPool(textsByLen) {
  const words = {};
  const byPattern = new Map(); // 'ㄷㅅㄱ' → ['다슬기', ...]
  for (const len of WORD_LENGTHS) {
    words[len] = parseList(textsByLen[len] ?? '');
    for (const w of words[len]) {
      const p = onsetsOf(w);
      if (!byPattern.has(p)) byPattern.set(p, []);
      byPattern.get(p).push(w);
    }
  }
  return {
    words,
    /** 초성열에 맞는 출제 단어들 (없으면 빈 배열) */
    matching: (pattern) => byPattern.get(pattern) ?? [],
  };
}

/**
 * 추측 허용 사전 — 입력 단어가 실제 명사인지.
 * 목록에 없어도 "상용 명사 + 상용 명사"로 쪼개지는 3~4글자면 합성어로 인정한다
 * (라면+집, 택시+비, 교통+카드, 운동화+끈 …). 부품은 compound-parts.txt(상용 명사 1~3글자).
 */
export function buildGuessDictionary(textsByLen, partsText = '') {
  const set = new Set();
  for (const len of WORD_LENGTHS) for (const w of parseList(textsByLen[len] ?? '')) set.add(w);
  const parts = new Set(parseList(partsText));
  const isCompound = (word) => {
    if (word.length < 3 || word.length > 4) return false;
    for (let i = 1; i < word.length; i++) {
      if (parts.has(word.slice(0, i)) && parts.has(word.slice(i))) return true;
    }
    return false;
  };
  return { has: (word) => set.has(word) || isCompound(word), size: set.size };
}

/** 브라우저에서 src/data/<kind>-<len>.txt 세 개를 받아 텍스트 맵으로 */
export async function fetchWordTexts(kind, baseUrl = 'src/data/') {
  const entries = await Promise.all(WORD_LENGTHS.map(async (len) => {
    const res = await fetch(`${baseUrl}${kind}-${len}.txt`);
    if (!res.ok) throw new Error(`${kind}-${len}.txt 불러오기 실패 (${res.status})`);
    return [len, await res.text()];
  }));
  return Object.fromEntries(entries);
}
