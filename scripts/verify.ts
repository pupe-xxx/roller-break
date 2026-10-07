// par が本当に最少かを、solve.ts とは別のやり方で確かめる。
// 使い方: npm run verify
// solve.ts は、発射数の少ない順に盤面を広げていき（幅優先）、盤が変わらない発射は飛ばす。
// ここでは、1つの撃ち方を最後まで追ってから戻る別の順番（深さ優先）で、何にも当たらない発射も飛ばさずに、
// par より1発少ない撃ち方を全部試して、どれでも倒しきれないことを見る。
import { LEVELS } from '../src/game/levels';
import { createState, fire, type Level, type State } from '../src/game/rules';

const boardKey = (s: State): string =>
  JSON.stringify([s.targets, Object.entries(s.walls).sort(), s.heavyLeft, s.rollers, Object.entries(s.plates).sort()]);

/** left 発以内の撃ち方を全部試して、倒しきれるものがあれば true。failed は「この盤面は、残り何発までなら無理と分かったか」 */
function clearable(state: State, left: number, failed: Map<string, number>): boolean {
  if (left === 0) return false;
  const key = boardKey(state);
  if ((failed.get(key) ?? 0) >= left) return false;
  for (let roller = 0; roller < state.rollers.length; roller++) {
    for (let dir = 0; dir < 6; dir++) {
      for (const kind of ['light', 'heavy'] as const) {
        const result = fire(state, { roller, dir, kind });
        if (!result) continue;
        if (result.state.status === 'cleared' || clearable(result.state, left - 1, failed)) return true;
      }
    }
  }
  failed.set(key, left);
  return false;
}

let bad = 0;
LEVELS.forEach((level: Level, i) => {
  const began = performance.now();
  const start = createState(level, Infinity);
  const reachable = clearable(start, level.par, new Map());
  const shorter = clearable(start, level.par - 1, new Map());
  if (!reachable || shorter) bad++;
  const sec = ((performance.now() - began) / 1000).toFixed(1);
  console.log(`ステージ ${i + 1}: par ${level.par}・${reachable ? 'par 発で倒せる' : 'par 発では倒せない'}・${shorter ? '1発少なくても倒せる' : '1発少ないと倒せない'}・${sec} 秒`);
});
console.log(bad === 0 ? 'すべて合っている' : `${bad} ステージが合っていない`);
process.exitCode = bad === 0 ? 0 : 1;
