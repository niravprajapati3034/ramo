import { Routes } from '@angular/router';
import { Home } from './pages/home/home';
import { WaitingRoom } from './pages/waiting-room/waiting-room';
import { Game } from './pages/game/game';

export const routes: Routes = [
  { path: '', component: Home },
  { path: 'waiting-room/:roomCode', component: WaitingRoom },
  { path: 'game/:roomCode', component: Game },
  { path: '**', redirectTo: '' },
];
