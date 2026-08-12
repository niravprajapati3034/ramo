import { Module } from '@nestjs/common';
import { RoomModule } from '../room/room.module';
import { GameGateway } from './game.gateway';
import { PuzzleModule } from 'src/puzzle/puzzle.module';

@Module({
  imports: [RoomModule, PuzzleModule],
  providers: [GameGateway],
})
export class GameModule {}
