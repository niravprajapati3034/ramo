import { Controller, Post, Get, Body, Param } from '@nestjs/common';
import { RoomService } from './room.service';

// Exposes REST endpoints for room and player management.
// Real-time game actions (starting the game, submitting answers) are handled separately
// via the GameGateway (Socket.io), while this controller handles the initial HTTP-based
// room creation and joining flow before a player connects to the socket.
@Controller('room')
export class RoomController {
  constructor(private readonly roomService: RoomService) {}

  /**
   * GET /room/:code
   * Fetches a room's details (including its player list) using the room code.
   * Used by the frontend to validate a room exists before joining, and to load
   * the waiting room screen.
   */
  @Get(':code')
  async getRoom(@Param('code') code: string) {
    return this.roomService.getRoomByCode(code);
  }

  /**
   * POST /room/create
   * Creates a new room with the given theme (defaults to "heist" if none is provided).
   * Returns the newly created room, including its generated room code and internal id.
   */
  @Post('create')
  async createRoom(@Body('theme') theme: string) {
    return this.roomService.createRoom(theme || 'heist');
  }

  /**
   * POST /room/join
   * Adds a player to an existing room using the room code and chosen nickname.
   * This creates the Player record in the database, which is required before
   * the player can participate in game actions like starting the game.
   */
  @Post('join')
  async joinRoom(
    @Body('roomCode') roomCode: string,
    @Body('nickname') nickname: string,
  ) {
    return this.roomService.joinRoom(roomCode, nickname);
  }

  /**
   * POST /room/:roomId/start
   * Legacy/manual endpoint for starting a game and assigning the traitor role via HTTP.
   * Note: the primary game-start flow now happens through the Socket.io "startGame" event
   * (see GameGateway), since that flow also handles puzzle generation and real-time
   * broadcasting to all connected players. This endpoint is kept for direct API testing.
   */
  @Post(':roomId/start')
  async startGame(@Param('roomId') roomId: string) {
    const traitor = await this.roomService.assignTraitor(roomId);
    return { message: 'Game started', traitorPlayerId: traitor.id };
  }
}
