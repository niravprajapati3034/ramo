import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Room } from '../entities/room.entity';
import { Player } from '../entities/player.entity';

// Handles all room and player-related database operations:
// creating rooms, joining rooms, fetching room details, and assigning the traitor role.
@Injectable()
export class RoomService {
  constructor(
    @InjectRepository(Room)
    private roomRepo: Repository<Room>,
    @InjectRepository(Player)
    private playerRepo: Repository<Player>,
  ) {}

  /**
   * Generates a random 6-character alphanumeric room code (e.g. "AB12CD").
   * Used as the human-friendly identifier players share to join a room,
   * as opposed to the internal UUID which is used for backend operations.
   */
  private generateRoomCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  /**
   * Creates a new room with a unique room code and the selected theme.
   * The room starts in "waiting" status until enough players join and the game is started.
   */
  async createRoom(theme: string): Promise<Room> {
    const room = this.roomRepo.create({
      roomCode: this.generateRoomCode(),
      theme,
      status: 'waiting',
    });
    return this.roomRepo.save(room);
  }

  /**
   * Adds a new player to an existing room using the room code.
   * Throws an error if no room exists with the given code.
   */
  async joinRoom(roomCode: string, nickname: string): Promise<Player> {
    const room = await this.roomRepo.findOne({ where: { roomCode } });
    if (!room) {
      throw new Error('Room not found');
    }

    const player = this.playerRepo.create({
      nickname,
      room,
    });
    return this.playerRepo.save(player);
  }

  /**
   * Fetches a room by its code, including the full list of joined players.
   * Used by the frontend to display the waiting room and verify a room exists before joining.
   */
  async getRoomByCode(roomCode: string): Promise<Room> {
    const room = await this.roomRepo.findOne({
      where: { roomCode },
      relations: ['players'],
    });
    if (!room) {
      throw new Error('Room not found');
    }
    return room;
  }

  /**
   * Randomly selects one player in the room to be the traitor when the game starts.
   * Requires at least 2 players so the traitor's identity can remain hidden among the group.
   */
  async assignTraitor(roomId: string): Promise<Player> {
    const room = await this.roomRepo.findOne({
      where: { id: roomId },
      relations: ['players'],
    });

    if (!room) {
      throw new Error('Room not found');
    }

    if (room.players.length < 1) {
      throw new Error('Need at least 1 player to start');
    }

    // Pick one random player from the room to become the traitor
    const randomIndex = Math.floor(Math.random() * room.players.length);
    const traitor = room.players[randomIndex];

    traitor.isTraitor = true;
    await this.playerRepo.save(traitor);

    // Mark the room as active now that the game has begun
    room.status = 'in-progress';
    await this.roomRepo.save(room);

    return traitor;
  }

  /**
   * Marks the room's game as officially started and records the start timestamp.
   * The timestamp is stored for potential future use (e.g. calculating total game duration).
   */
  async markGameStarted(roomId: string): Promise<void> {
    await this.roomRepo.update(roomId, {
      status: 'in-progress',
      startedAt: new Date(),
    });
  }

  /**
   * Marks the room's game as finished (either won or lost) and records the finish timestamp.
   */
  async markGameFinished(roomId: string): Promise<void> {
    await this.roomRepo.update(roomId, {
      status: 'finished',
      finishedAt: new Date(),
    });
  }

  /**
   * Fetches the nickname of the player currently marked as the traitor in a room.
   * Used at game-end to reveal who the traitor was, giving the traitor mechanic
   * a meaningful payoff instead of the role going unused for the whole game.
   */
  async getTraitorNickname(roomId: string): Promise<string | null> {
    const room = await this.roomRepo.findOne({
      where: { id: roomId },
      relations: ['players'],
    });

    if (!room) return null;

    const traitor = room.players.find((p) => p.isTraitor);
    return traitor ? traitor.nickname : null;
  }
}
