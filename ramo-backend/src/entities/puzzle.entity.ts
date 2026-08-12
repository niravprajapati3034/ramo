import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';
import { Room } from './room.entity';

@Entity('puzzles')
export class Puzzle {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  question: string;

  @Column()
  answer: string;

  @Column()
  hint: string;

  @Column()
  narration: string; // AI Game Master ni story text

  @Column()
  orderIndex: number; // puzzle sequence (1, 2, 3...)

  @Column({ default: false })
  solved: boolean;

  @ManyToOne(() => Room)
  room: Room;
}
