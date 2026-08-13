import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { RoomService } from '../room/room.service';
import { PuzzleService } from '../puzzle/puzzle.service';

// Tracks the active end-of-game timeout for each room (roomCode -> timeout reference).
const activeTimers = new Map<string, NodeJS.Timeout>();

// Tracks the exact timestamp (epoch ms) each room's game will end.
// Sent to clients ONCE when the timer starts; each client then counts down
// locally based on this fixed timestamp rather than relying on a per-second
// server broadcast. This makes the countdown immune to network latency/jitter -
// a player far from the server (e.g. across states/countries) will never see
// the timer jump backward, since there's no cumulative counter to get out of sync.
const roomEndTimes = new Map<string, number>();

// Tracks which room and player each active socket connection belongs to
// (socketId -> { roomCode, playerId, nickname }).
const socketPlayerMap = new Map<
  string,
  { roomCode: string; playerId: string; nickname: string }
>();

@WebSocketGateway({
  cors: {
    origin: '*', // Allow all origins in dev; restrict this to the frontend domain in production
  },
})
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  // Total time (in seconds) players have to solve all puzzles before the game is lost
  private readonly GAME_DURATION_SECONDS = 600; // 10 minutes

  constructor(
    private readonly roomService: RoomService,
    private readonly puzzleService: PuzzleService,
  ) {}

  handleConnection(client: Socket) {
    console.log(`Client connected: ${client.id}`);
  }

  async handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);

    const playerInfo = socketPlayerMap.get(client.id);
    if (!playerInfo) return;

    const { roomCode, nickname } = playerInfo;

    this.server.to(roomCode).emit('playerDisconnected', {
      nickname,
      message: `${nickname} has disconnected.`,
    });

    socketPlayerMap.delete(client.id);
  }

  @SubscribeMessage('joinRoom')
  async handleJoinRoom(
    @MessageBody()
    data: { roomCode: string; playerId: string; nickname: string },
    @ConnectedSocket() client: Socket,
  ) {
    client.join(data.roomCode);

    socketPlayerMap.set(client.id, {
      roomCode: data.roomCode,
      playerId: data.playerId,
      nickname: data.nickname,
    });

    this.server.to(data.roomCode).emit('playerJoined', {
      playerId: data.playerId,
      nickname: data.nickname,
    });
  }

  @SubscribeMessage('startGame')
  async handleStartGame(
    @MessageBody() data: { roomId: string; roomCode: string; theme: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const existingPuzzles = await this.puzzleService.getPuzzlesByRoom(
        data.roomId,
      );
      if (existingPuzzles.length > 0) {
        const currentPuzzle =
          existingPuzzles.find((p) => !p.solved) || existingPuzzles[0];
        client.emit('newPuzzle', {
          puzzleId: currentPuzzle.id,
          question: currentPuzzle.question,
          hint: currentPuzzle.hint,
          narration: currentPuzzle.narration,
          orderIndex: currentPuzzle.orderIndex,
          totalPuzzles: existingPuzzles.length,
        });
        return;
      }

      const traitor = await this.roomService.assignTraitor(data.roomId);
      await this.roomService.markGameStarted(data.roomId);

      const puzzles = await this.puzzleService.generatePuzzles(
        data.roomId,
        data.theme,
        5,
      );

      this.server.to(data.roomCode).emit('gameStarted', {
        message: 'The game has begun! One among you is a traitor...',
      });

      this.server.to(data.roomCode).emit('traitorAssigned', {
        traitorPlayerId: traitor.id,
      });

      const firstPuzzle = puzzles[0];
      this.server.to(data.roomCode).emit('newPuzzle', {
        puzzleId: firstPuzzle.id,
        question: firstPuzzle.question,
        hint: firstPuzzle.hint,
        narration: firstPuzzle.narration,
        orderIndex: firstPuzzle.orderIndex,
        totalPuzzles: puzzles.length,
      });

      this.startRoomTimer(data.roomCode);
    } catch (error) {
      client.emit('startGameError', { message: error.message });
    }
  }

  @SubscribeMessage('submitAnswer')
  async handleSubmitAnswer(
    @MessageBody()
    data: {
      roomCode: string;
      puzzleId: string;
      answer: string;
      nickname: string;
    },
    @ConnectedSocket() client: Socket,
  ) {
    const result = await this.puzzleService.submitAnswer(
      data.puzzleId,
      data.answer,
    );

    if (result.correct) {
      this.server.to(data.roomCode).emit('answerCorrect', {
        nickname: data.nickname,
      });

      if (result.nextPuzzle) {
        this.server.to(data.roomCode).emit('newPuzzle', {
          puzzleId: result.nextPuzzle.id,
          question: result.nextPuzzle.question,
          hint: result.nextPuzzle.hint,
          narration: result.nextPuzzle.narration,
          orderIndex: result.nextPuzzle.orderIndex,
        });
      } else {
        await this.endGame(data.roomCode, 'won');
      }
    } else {
      client.emit('answerWrong', { message: 'Wrong answer, try again!' });
    }
  }

  /**
   * Starts the countdown for a room by broadcasting a single fixed end timestamp
   * to all players (rather than a per-second "time left" value). Clients calculate
   * their own remaining time locally as (endTime - now), which stays accurate
   * regardless of network latency between the server and each player.
   *
   * The server still independently schedules its own timeout to authoritatively
   * end the game when time runs out - this is the source of truth for win/loss,
   * the client-side countdown is purely visual.
   */
  private startRoomTimer(roomCode: string) {
    this.clearRoomTimer(roomCode);

    const endTime = Date.now() + this.GAME_DURATION_SECONDS * 1000;
    roomEndTimes.set(roomCode, endTime);

    this.server.to(roomCode).emit('timerStarted', { endTime });

    const timeout = setTimeout(async () => {
      await this.endGame(roomCode, 'lost');
    }, this.GAME_DURATION_SECONDS * 1000);

    activeTimers.set(roomCode, timeout);
  }

  // Stops and removes the active timer for a room, if one exists.
  private clearRoomTimer(roomCode: string) {
    const existing = activeTimers.get(roomCode);
    if (existing) {
      clearTimeout(existing);
      activeTimers.delete(roomCode);
    }
    roomEndTimes.delete(roomCode);
  }

  private async endGame(roomCode: string, outcome: 'won' | 'lost') {
    this.clearRoomTimer(roomCode);

    const room = await this.roomService.getRoomByCode(roomCode);
    await this.roomService.markGameFinished(room.id);

    this.server.to(roomCode).emit('gameComplete', {
      outcome,
      message:
        outcome === 'won'
          ? 'Congratulations! You escaped in time!'
          : "Time's up! You didn't escape in time.",
    });
  }

  @SubscribeMessage('resyncRoom')
  async handleResyncRoom(
    @MessageBody() data: { roomCode: string; roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    client.join(data.roomCode);

    const room = await this.roomService.getRoomByCode(data.roomCode);

    if (room.status === 'finished') {
      client.emit('gameComplete', {
        outcome: 'lost',
        message: 'This game has already ended.',
      });
      return;
    }

    if (room.status === 'waiting') {
      return;
    }

    // Resend the fixed end timestamp so a reconnecting client's local countdown
    // stays in sync with everyone else's, instead of restarting from scratch.
    const endTime = roomEndTimes.get(data.roomCode);
    if (endTime) {
      client.emit('timerStarted', { endTime });
    }

    const puzzles = await this.puzzleService.getPuzzlesByRoom(data.roomId);
    if (puzzles.length > 0) {
      const currentPuzzle =
        puzzles.find((p) => !p.solved) || puzzles[puzzles.length - 1];
      client.emit('newPuzzle', {
        puzzleId: currentPuzzle.id,
        question: currentPuzzle.question,
        hint: currentPuzzle.hint,
        narration: currentPuzzle.narration,
        orderIndex: currentPuzzle.orderIndex,
        totalPuzzles: puzzles.length,
      });
    }
  }
}
