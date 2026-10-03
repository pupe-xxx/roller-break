// 画面なしで CPU 同士を対戦させ、勝敗の内訳を出す。
// 使い方: npm run sim -- [試合数] [最初の種]
import { playMany } from '../src/game/sim';

const games = Number(process.argv[2] ?? 1000);
const firstSeed = Number(process.argv[3] ?? 1);

const started = performance.now();
const tally = playMany(games, firstSeed);
const ms = Math.round(performance.now() - started);

const pct = (n: number) => `${((n / games) * 100).toFixed(1)}%`;
console.log(`${games} 試合（種 ${firstSeed}〜${firstSeed + games - 1}）  ${ms}ms`);
console.log(`先手の勝ち ${tally.p1} (${pct(tally.p1)})  後手の勝ち ${tally.p2} (${pct(tally.p2)})  引き分け ${tally.draw} (${pct(tally.draw)})`);
