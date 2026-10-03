// ステージの一覧。最初の3つは遊び方を覚えるための手作り。残りは scripts/gen.ts が作る。
import { GENERATED } from './levels.gen';
import type { Level } from './rules';

const INTRO: Level[] = [
  // 的はまっすぐ先にある
  { radius: 2, rollers: [[0, 0]], targets: [[2, 0], [0, -2]], walls: [], heavy: 0, par: 2 },
  // 壁は1発で1段削れる
  { radius: 2, rollers: [[0, 0]], targets: [[2, 0], [-1, 1]], walls: [[1, 0, 1]], heavy: 0, par: 3 },
  // 重いタイヤは的を貫く
  { radius: 2, rollers: [[-2, 0]], targets: [[-1, 0], [0, 0], [1, 0]], walls: [], heavy: 1, par: 1 },
];

export const LEVELS: Level[] = [...INTRO, ...GENERATED];
