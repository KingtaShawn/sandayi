/**
 * engine/deck.js —— 牌堆构建 / 洗牌 / 发牌切分（纯函数）。
 */

'use strict';

const { createCard, SUITS } = require('./card');
const { rankSequence } = require('./config');

/**
 * 按 RuleConfig 构建整副牌（deckCount 副 × 54 张，含大小王）。
 * @param {object} cfg
 * @returns {Array<object>} Card[]
 */
function buildDeck(cfg) {
  const deck = [];
  const ranks = rankSequence(cfg).length === 13
    ? rankSequence(cfg)
    : ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  for (let d = 0; d < cfg.deckCount; d++) {
    SUITS.forEach((suit) => {
      ranks.forEach((rank) => {
        deck.push(createCard(d, suit, rank));
      });
    });
    deck.push(createCard(d, 'JOKER', 'RJ')); // 小王
    deck.push(createCard(d, 'JOKER', 'BJ')); // 大王
  }
  return deck;
}

/**
 * Fisher-Yates 洗牌（返回新数组，不修改入参；随机性全部走注入 rng，§8.7）。
 * @param {Array} cards
 * @param {{next: function(): number}} rng
 * @returns {Array}
 */
function shuffle(cards, rng) {
  const arr = cards.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

/**
 * 发牌切分：每人 (总数-底牌)/4 张，余下为底牌（R2）。
 * @param {Array} deck 已洗牌堆
 * @param {object} cfg
 * @returns {{hands: Array<Array<object>>, bottom: Array<object>, perPlayer: number}}
 * @throws {Error} 牌数与配置不符
 */
function dealInitial(deck, cfg) {
  const total = 54 * cfg.deckCount;
  if (deck.length !== total) {
    throw new Error(`发牌失败：牌堆 ${deck.length} 张 ≠ 配置 ${total} 张`);
  }
  const perPlayer = (total - cfg.bottomCards) / 4;
  if (!Number.isInteger(perPlayer) || perPlayer <= 0) {
    throw new Error('发牌失败：底牌张数配置不能整除');
  }
  const hands = [[], [], [], []];
  let i = 0;
  for (let round = 0; round < perPlayer; round++) {
    for (let p = 0; p < 4; p++) {
      hands[p].push(deck[i++]);
    }
  }
  const bottom = deck.slice(i);
  return { hands, bottom, perPlayer };
}

module.exports = { buildDeck, shuffle, dealInitial };
