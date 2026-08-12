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

// In-memory map to track active game timers per room (roomCode -> interval reference)
// This does not need to persist in DB since it's just a live countdown
const activeTimers = new Map<string, NodeJS.Timeout>();

// In-memory map to track socketId -> { roomCode, playerId } for disconnect cleanup
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

  // Default game duration in seconds (used for timer sync)
  private readonly GAME_DURATION_SECONDS = 600; // 10 minutes

  constructor(
    private readonly roomService: RoomService,
    private readonly puzzleService: PuzzleService,
  ) {}

  handleConnection(client: Socket) {
    console.log(`Client connected: ${client.id}`);
  }

  // Called automatically when a client disconnects (browser closed, network drop, etc.)
  async handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);

    const playerInfo = socketPlayerMap.get(client.id);
    if (!playerInfo) return; // This socket was never tracked as a joined player

    const { roomCode, nickname } = playerInfo;

    // Notify remaining players in the room that someone left
    this.server.to(roomCode).emit('playerDisconnected', {
      nickname,
      message: `${nickname} has disconnected.`,
    });

    // Clean up the map entry
    socketPlayerMap.delete(client.id);
  }

  @SubscribeMessage('joinRoom')
  async handleJoinRoom(
    @MessageBody()
    data: { roomCode: string; playerId: string; nickname: string },
    @ConnectedSocket() client: Socket,
  ) {
    client.join(data.roomCode);

    // Track this socket so we can handle disconnects properly later
    socketPlayerMap.set(client.id, {
      roomCode: data.roomCode,
      playerId: data.playerId,
      nickname: data.nickname,
    });

    // Notify everyone else in the room that a new player joined
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
      // Prevent double-start: check if this room already has puzzles generated
      const existingPuzzles = await this.puzzleService.getPuzzlesByRoom(
        data.roomId,
      );
      if (existingPuzzles.length > 0) {
        // Game already started for this room - just resend the first unsolved puzzle instead of regenerating
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

      // 1. Randomly assign the traitor role to one player
      const traitor = await this.roomService.assignTraitor(data.roomId);

      // 2. Mark the room as started (records startedAt timestamp)
      await this.roomService.markGameStarted(data.roomId);

      // 3. Generate a fresh set of AI puzzles for this room
      const puzzles = await this.puzzleService.generatePuzzles(
        data.roomId,
        data.theme,
        5,
      );

      // 4. Notify all players that the game has begun
      this.server.to(data.roomCode).emit('gameStarted', {
        message: 'The game has begun! One among you is a traitor...',
      });

      // 5. Broadcast the traitor assignment
      // NOTE: In production this should be a private emit to only the traitor's socket.
      // Keeping it broadcast for now since we don't yet map playerId -> socketId reliably.
      this.server.to(data.roomCode).emit('traitorAssigned', {
        traitorPlayerId: traitor.id,
      });

      // 6. Send the first puzzle to all players (answer is never sent to the client)
      const firstPuzzle = puzzles[0];
      this.server.to(data.roomCode).emit('newPuzzle', {
        puzzleId: firstPuzzle.id,
        question: firstPuzzle.question,
        hint: firstPuzzle.hint,
        narration: firstPuzzle.narration,
        orderIndex: firstPuzzle.orderIndex,
        totalPuzzles: puzzles.length,
      });

      // 7. Start the synced countdown timer for this room
      this.startRoomTimer(data.roomCode, data.roomId);
    } catch (error) {
      // Send the error only to the player who tried to start the game
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
      // Let everyone know who solved it
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
        // All puzzles solved - end the game as a WIN
        await this.endGame(data.roomCode, 'won');
      }
    } else {
      // Only notify the player who submitted the wrong answer, not the whole room
      client.emit('answerWrong', { message: 'Wrong answer, try again!' });
    }
  }

  // Starts a server-authoritative countdown timer for a room and broadcasts updates every second
  private startRoomTimer(roomCode: string, roomId: string) {
    // Clear any existing timer for this room first (avoids duplicate intervals)
    this.clearRoomTimer(roomCode);

    let timeLeft = this.GAME_DURATION_SECONDS;

    const interval = setInterval(async () => {
      timeLeft -= 1;

      this.server.to(roomCode).emit('timerUpdate', { timeLeft });

      if (timeLeft <= 0) {
        this.clearRoomTimer(roomCode);
        // Time ran out before puzzles were solved - end the game as a LOSS
        await this.endGame(roomCode, 'lost');
      }
    }, 1000);

    activeTimers.set(roomCode, interval);
  }

  // Stops and removes the timer for a given room
  private clearRoomTimer(roomCode: string) {
    const existing = activeTimers.get(roomCode);
    if (existing) {
      clearInterval(existing);
      activeTimers.delete(roomCode);
    }
  }

  // Shared logic for ending a game, whether by winning or running out of time
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

  /**
   * Called when a client's socket reconnects (e.g. after the browser tab was closed
   * or suspended and reopened later). Fetches the current state of the room and
   * sends the client whatever they need to catch up: either the final outcome if
   * the game already ended, or the current active puzzle if it's still in progress.
   * This prevents the UI from staying stuck showing stale data from before the disconnect.
   */
  @SubscribeMessage('resyncRoom')
  async handleResyncRoom(
    @MessageBody() data: { roomCode: string; roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    // Rejoin the Socket.io room so this client resumes receiving live broadcasts
    client.join(data.roomCode);

    const room = await this.roomService.getRoomByCode(data.roomCode);

    if (room.status === 'finished') {
      client.emit('gameComplete', {
        outcome: 'lost', // Exact outcome isn't stored separately; safe default for a resync case
        message: 'This game has already ended.',
      });
      return;
    }

    if (room.status === 'waiting') {
      // Game hasn't started yet - nothing to resync, the waiting room screen will handle this
      return;
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
