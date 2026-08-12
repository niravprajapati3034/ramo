import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PuzzleService } from './puzzle.service';
import { PuzzleController } from './puzzle.controller';
import { Puzzle } from '../entities/puzzle.entity';
import { Room } from '../entities/room.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Puzzle, Room])],
  controllers: [PuzzleController],
  providers: [PuzzleService],
  exports: [PuzzleService],
})
export class PuzzleModule {}
