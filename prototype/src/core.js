/* WordShip prototype — core
 * 한글 유틸 / PRNG / 밸런스 상수 / 사전
 * 0단계 목표는 "규칙이 의도대로 발동하는가"이므로 밸런스는 고정값으로 둔다.
 */
(function (WS) {
  'use strict';

  /* ── 한글 ──────────────────────────────────────────────── */
  var CHO = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
  var BASE = 0xAC00, LAST = 0xD7A3;

  function isSyllable(ch) {
    if (!ch) return false;
    var c = ch.codePointAt(0);
    return c >= BASE && c <= LAST;
  }
  function onsetOf(ch) {
    if (!isSyllable(ch)) return null;
    return CHO[Math.floor((ch.codePointAt(0) - BASE) / 588)];
  }
  function onsetsOf(word) {
    return Array.prototype.map.call(word, onsetOf);
  }
  /** 초성 + 모음index + 받침index → 음절 */
  function compose(cho, jung, jong) {
    var ci = CHO.indexOf(cho);
    if (ci < 0) return null;
    return String.fromCodePoint(BASE + ci * 588 + (jung || 0) * 28 + (jong || 0));
  }

  WS.hangul = { CHO: CHO, isSyllable: isSyllable, onsetOf: onsetOf, onsetsOf: onsetsOf, compose: compose };

  /* ── PRNG (결정론적 시드) ───────────────────────────────── */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashSeed(str) {
    var h = 1779033703 ^ String(str).length;
    for (var i = 0; i < String(str).length; i++) {
      h = Math.imul(h ^ String(str).charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return h >>> 0;
  }
  WS.rng = { mulberry32: mulberry32, hashSeed: hashSeed };

  /* ── 밸런스 (§11 — 동작 검증용 초기값. 튜닝 보류) ──────────
   * v0.4: 턴제 폐지. AP는 시간에 따라 차오르는 자원(클래시 로얄 엘릭서 방식).
   *       함선당 1행동 제한 대신 함선별 쿨타임.
   */
  WS.BALANCE = {
    board: { w: 10, h: 25, deployRows: 10 },
    onset: { majorRatio: 0.8 },

    ap:    { max: 10, start: 5, regenMs: 2500 },   // 2.5초마다 1, 최대 10
    cost:  { move: 3, scan: 1, identify: 2, fire: 1 },
    cooldown: { movePerLen: 3000, scan: 5000, identify: 8000, fire: 6000 },

    ships: [                                        // 5칸 삭제, 4칸 3척
      { len: 4, count: 3, hp: 6, fireRange: 5 },
      { len: 3, count: 5, hp: 3, fireRange: 3 }
    ],
    scan:     { length: 5 },
    identify: { range: 7, minLen: 3, maxLen: 4 },   // 5글자 폐지
    damage:   { base: 1, precisionBonus: 1, identifiedMult: 3 },
    reveal:   { enemyHpOnlyWhenIdentified: true },  // 식별당한 함선만 체력·피해 표시
    move:     { banSameCells: true },               // 자기 자리로 이동 금지 (함명 중복은 허용)
    win:      { landingRow: 25, landingNeedsFullShip: false },
    gen:      { maxMinorRun: 2 },
    MAJOR:    ['ㄱ','ㄴ','ㄷ','ㄹ','ㅁ','ㅂ','ㅅ','ㅇ','ㅈ','ㅎ'],
    MINOR_W:  { 'ㅊ':0.22, 'ㅌ':0.18, 'ㅍ':0.16, 'ㅋ':0.14, 'ㄲ':0.12, 'ㅆ':0.10, 'ㅉ':0.04, 'ㄸ':0.03, 'ㅃ':0.01 }
  };

  /* ── 사전 ──────────────────────────────────────────────────
   * 0단계 기본값은 PERMISSIVE(허용 사전)다.
   * 스텁 단어 목록으로는 초성 조합이 거의 맞지 않아 배가 한 칸도 못 움직이고,
   * 그러면 이동·식별·포격·침몰·상륙 중 아무것도 검증할 수 없다.
   * 사전은 §6의 독립 부품이므로 나중에 끼운다.
   */
  var STUB_WORDS = [
    // 3글자 — 실제 검증용 스텁. 정식 사전은 §6.4 파이프라인으로 따로 빌드한다.
    '고양이','강아지','다람쥐','도시락','다슬기','무지개','바나나','보름달','사다리','소나무',
    '아버지','어머니','자전거','지우개','코끼리','호랑이','개구리','거북이','나팔꽃','단풍잎',
    '두더지','미나리','민들레','병아리','사마귀','선인장','시금치','오징어','옥수수','운동화',
    '유리창','이슬비','잠자리','장미꽃','제비꽃','진달래','청소기','초콜릿','카메라','컴퓨터',
    '해파리','달팽이','도깨비','소쩍새','앵무새','얼룩말','오솔길','지렁이','초승달','파랑새',
    '풍뎅이','하늘소','잠수함','나침반','토마토','코뿔소','바가지','수박씨','국자루','머리띠',
    // 4글자
    '바이올린','무당벌레','코스모스','해바라기','고슴도치','개나리꽃','물레방아','바람개비',
    '사슴벌레','소금쟁이','수수께끼','자두나무','청개구리','호랑나비','미꾸라지','반딧불이',
    '버드나무','오토바이','알루미늄','바이러스','텔레비전','고구마순',
    // 5글자
    '아이스크림','회오리바람','보리수나무','자동판매기','미끄럼틀장'
  ];

  function makePermissiveDict() {
    return {
      name: 'PERMISSIVE',
      label: '허용 사전 (초성만 검사)',
      has: function (word) {
        if (!word) return false;
        var n = Array.from(word).length;
        if (n < 3 || n > 5) return false;
        return Array.from(word).every(isSyllable);
      }
    };
  }

  function makeStubDict() {
    var set = new Set(STUB_WORDS);
    return {
      name: 'STUB',
      label: '스텁 사전 (' + STUB_WORDS.length + '단어)',
      has: function (word) { return set.has(word); },
      words: STUB_WORDS
    };
  }

  WS.dict = {
    permissive: makePermissiveDict(),
    stub: makeStubDict(),
    STUB_WORDS: STUB_WORDS
  };

})(window.WS = window.WS || {});
