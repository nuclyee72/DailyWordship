/**
 * easterEgg.js — 특정 단어를 추측하면 화면 오른쪽 아래에서 캐릭터가 뛰어올랐다 내려간다 (위쪽 60%만 보임).
 * 기회 +1은 게임 규칙 쪽 — src/game/game.js BONUS_WORDS.
 * 단어는 추측 사전에도 들어 있어야 한다 (src/data/curated/guesses-extra.txt).
 * 애니메이션은 style.css의 .easter-egg — 끝나면 스스로 사라진다. 판·입력은 막지 않는다(pointer-events: none).
 */
const EGGS = {
  메루루: 'src/assets/meruru.webp', // layer/ 의 base → eye_bottom → eye_middle → eye_top 을 합친 한 장
};

let current = null;

export function playEasterEgg(word) {
  const src = EGGS[word];
  if (!src) return false;
  current?.remove(); // 연달아 입력하면 처음부터 다시
  const img = document.createElement('img');
  img.className = 'easter-egg';
  img.src = src;
  img.alt = '';
  img.setAttribute('aria-hidden', 'true');
  img.addEventListener('animationend', () => { img.remove(); if (current === img) current = null; });
  document.body.append(img);
  current = img;
  return true;
}
