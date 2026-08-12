import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';
import { Room } from './room.entity';

@Entity('players')
export class Player {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  nickname: string;

  // Socket.io connection ID, used to track active connections and handle disconnects
  @Column({ nullable: true })
  socketId: string;

  @Column({ default: false })
  isTraitor: boolean;

  // Tracks whether the player is currently connected (for reconnect/disconnect UI)
  @Column({ default: true })
  isConnected: boolean;

  @ManyToOne(() => Room, (room) => room.players)
  room: Room;
}
