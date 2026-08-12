import { Module } from '@nestjs/common';
import { RoomController } from './room.controller';
import { RoomService } from './room.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Room } from 'src/entities/room.entity';
import { Player } from 'src/entities/player.entity';
import { GameGateway } from 'src/game/game.gateway';

@Module({
  imports: [TypeOrmModule.forFeature([Room, Player])],
  controllers: [RoomController],
  providers: [RoomService],
  exports: [RoomService],
})
export class RoomModule {}
