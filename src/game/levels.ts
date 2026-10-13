// ステージの一覧。遊び方を覚えるステージは手作り。残りは scripts/gen.ts が作る。
import { GENERATED } from './levels.gen';
import type { Level } from './rules';

// 的はまっすぐ先にある
const LIGHT_INTRO: Level = { radius: 2, rollers: [[0, 0]], targets: [[2, 0], [0, -2]], walls: [], heavy: 0, par: 2 };

// 壁は1発で1段削れる
const WALL_INTRO: Level = { radius: 2, rollers: [[0, 0]], targets: [[2, 0], [-1, 1]], walls: [[1, 0, 1]], heavy: 0, par: 3 };

// 重いタイヤは3つまで壊して進む（4つ目の的は残る）
const HEAVY_INTRO: Level = { radius: 2, rollers: [[-2, 0]], targets: [[-1, 0], [0, 0], [1, 0], [2, 0]], walls: [], heavy: 1, par: 2 };

// 転師にタイヤを当てると、1マス押されて、撃てる線が変わる
const PUSH_INTRO: Level = { radius: 2, rollers: [[-2, 0], [0, 0]], targets: [[1, -2]], walls: [], heavy: 0, par: 2 };

// 板に当たるとタイヤが曲がり、板は逆向きに切り替わる
const PLATE_INTRO: Level = { radius: 2, rollers: [[-2, 0]], targets: [[2, -2], [0, 2]], walls: [], plates: [[0, 0, 1]], heavy: 0, par: 2 };

// 板で曲がったタイヤでも、仲間は押される（曲がった先の向きへ動く）。後半は、これを使わないと最少で解けない
const COMBO_INTRO: Level = { radius: 2, rollers: [[0, -2], [-1, 0]], targets: [[1, 1]], walls: [], plates: [[0, -1, -1]], heavy: 0, par: 2 };

// 鉄の壁は、重いタイヤでも壊れない。鉄の向こうの的は、仲間を押して、回り込んで倒す
const IRON_INTRO: Level = { radius: 2, rollers: [[0, 0], [-1, 1]], targets: [[-2, 0], [2, -2]], walls: [], iron: [[-1, 0]], heavy: 0, par: 3 };

// 爆弾に当てると爆ぜて、隣の的が一緒に倒れる（爆弾は倒さなくてもよい）
const BOMB_INTRO: Level = { radius: 2, rollers: [[-2, 0]], targets: [[1, 0], [1, -1], [0, 1], [-2, 2]], bombs: [[0, 0]], walls: [], heavy: 0, par: 2 };

// 盾付きの的は、重いタイヤでないと倒れない
const SHIELD_INTRO: Level = { radius: 2, rollers: [[2, -2]], targets: [[0, -2], [0, 0], [-1, 1]], shields: [[0, -2]], walls: [], heavy: 1, par: 3 };

// ワープ穴に入ったタイヤは、同じ番号の穴から、同じ向きで出てくる
const WARP_INTRO: Level = { radius: 2, rollers: [[-2, 2]], targets: [[-1, -1], [-1, 0], [-2, 1]], warps: [[-1, 2, -2, 0]], walls: [], heavy: 0, par: 3 };

// 跳ね返す板に当たったタイヤは、戻ってきて、撃ったキャラを押す
const MIRROR_INTRO: Level = { radius: 2, rollers: [[0, 2], [0, -1]], targets: [[-1, 1], [1, -2]], mirrors: [[2, -1]], walls: [], heavy: 0, par: 3 };

/** 1つの区切りのステージ数。星を集めると、次の区切りが開く */
export const BLOCK_SIZE = 20;

/** 新しいルールを覚えるステージが、何番目に入るか（0 から数える）。1・3・5 と1つ飛ばしで出し、間に練習のステージを挟む */
export const WALL_INTRO_AT = 2;
export const HEAVY_INTRO_AT = 4;
export const PUSH_INTRO_AT = 10;
export const PLATE_INTRO_AT = 19;
export const COMBO_INTRO_AT = 40;
export const IRON_INTRO_AT = 50;
export const BOMB_INTRO_AT = 60;
export const SHIELD_INTRO_AT = 70;
export const WARP_INTRO_AT = 80;
export const MIRROR_INTRO_AT = 90;

// 並び：軽い → 練習（1）→ 壁 → 練習（1）→ 重い → 練習（5）→ 押す → 練習（8）→ 板 → 練習（20）
// → 板で曲げて押す → 練習（9）→ 鉄の壁 → 練習（9）→ 爆弾 → 練習（9）→ 盾 → 練習（9）→ ワープ → 練習（9）→ 跳ね返す板 → 練習（9）。
// 全部で 100
// 段階の数は scripts/gen.ts の TIERS と合わせる
// 押すのを覚える前のステージでは、転師は押されても動かない（説明の無いルールが、先に出てこないように）
const noPush = (level: Level): Level => ({ ...level, push: false });

export const LEVELS: Level[] = [
  ...[LIGHT_INTRO, ...GENERATED.slice(0, 1), WALL_INTRO, ...GENERATED.slice(1, 2), HEAVY_INTRO, ...GENERATED.slice(2, 7)].map(noPush),
  PUSH_INTRO,
  ...GENERATED.slice(7, 15),
  PLATE_INTRO,
  ...GENERATED.slice(15, 35),
  COMBO_INTRO,
  ...GENERATED.slice(35, 44),
  IRON_INTRO,
  ...GENERATED.slice(44, 53),
  BOMB_INTRO,
  ...GENERATED.slice(53, 62),
  SHIELD_INTRO,
  ...GENERATED.slice(62, 71),
  WARP_INTRO,
  ...GENERATED.slice(71, 80),
  MIRROR_INTRO,
  ...GENERATED.slice(80, 89),
];
