import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  CreateDateColumn,
} from 'typeorm';
import { Player } from './player.entity';

@Entity('rooms')
export class Room {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  roomCode: string;

  @Column({ default: 'heist' })
  theme: string;

  // waiting | in-progress | finished
  @Column({ default: 'waiting' })
  status: string;

  // Timestamp when the game actually started (used to calculate completion time)
  @Column({ nullable: true })
  startedAt: Date;

  // Timestamp when the game was completed (all puzzles solved)
  @Column({ nullable: true })
  finishedAt: Date;

  @OneToMany(() => Player, (player) => player.room)
  players: Player[];

  @CreateDateColumn()
  createdAt: Date;
}
