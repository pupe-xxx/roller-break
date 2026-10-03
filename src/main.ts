// 入口。外枠（ui/shell）に、このゲームの中身（ui/game）を渡して始める。
import './ui/style.css';
import { game } from './ui/game';
import { runGame } from './ui/shell';

void runGame(game);
