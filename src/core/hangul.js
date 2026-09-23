/**
 * hangul.js — 한글 음절 → 초성. (옛 prototype/src/core.js의 한글 유틸을 ES 모듈로 이식)
 */
export const CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const BASE = 0xac00;
const LAST = 0xd7a3;

export function isSyllable(ch) {
  if (!ch) return false;
  const c = ch.codePointAt(0);
  return c >= BASE && c <= LAST;
}

/** 완성형 음절의 초성. 음절이 아니면 null */
export function onsetOf(ch) {
  if (!isSyllable(ch)) return null;
  return CHO[Math.floor((ch.codePointAt(0) - BASE) / 588)];
}

/** 단어 → 초성 문자열 ('다슬기' → 'ㄷㅅㄱ') */
export function onsetsOf(word) {
  return [...word].map(onsetOf).join('');
}
