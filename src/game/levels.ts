// ステージの一覧。遊び方を覚えるステージは手作り。残りは scripts/gen.ts が作る。
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

// 転師にタイヤを当てると、1マス押されて、撃てる線が変わる
const PUSH_INTRO: Level = { radius: 2, rollers: [[-2, 0], [0, 0]], targets: [[1, -2]], walls: [], heavy: 0, par: 2 };

// 板に当たるとタイヤが曲がり、板は逆向きに切り替わる
const PLATE_INTRO: Level = { radius: 2, rollers: [[-2, 0]], targets: [[2, -2], [0, 2]], walls: [], plates: [[0, 0, 1]], heavy: 0, par: 2 };

/** 押すのを覚えるステージ・板を覚えるステージが、何番目に入るか（0 から数える） */
export const PUSH_INTRO_AT = INTRO.length + 5;
export const PLATE_INTRO_AT = PUSH_INTRO_AT + 1 + 4;

// 並び：覚える3つ → 壁と重いタイヤ（5）→ 押すのを覚える → 押す（4）→ 板を覚える → 板（4）→ 両方（6）
export const LEVELS: Level[] = [
  ...INTRO,
  ...GENERATED.slice(0, 5),
  PUSH_INTRO,
  ...GENERATED.slice(5, 9),
  PLATE_INTRO,
  ...GENERATED.slice(9),
];
