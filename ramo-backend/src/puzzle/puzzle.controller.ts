import { Controller, Post, Get, Body, Param } from '@nestjs/common';
import { PuzzleService } from './puzzle.service';

// Exposes REST endpoints for puzzle generation, retrieval, and answer submission.
// These are primarily used for direct API testing (e.g. via Thunder Client) during
// development. In the live game flow, puzzle generation and answer submission happen
// through the Socket.io GameGateway instead, since those actions need to broadcast
// real-time updates to every player in the room.
@Controller('puzzle')
export class PuzzleController {
  constructor(private readonly puzzleService: PuzzleService) {}

  /**
   * POST /puzzle/generate
   * Triggers AI generation of a fresh puzzle set for a given room and theme.
   * Defaults to 5 puzzles if no count is specified.
   */
  @Post('generate')
  async generatePuzzles(
    @Body('roomId') roomId: string,
    @Body('theme') theme: string,
    @Body('count') count: number,
  ) {
    return this.puzzleService.generatePuzzles(roomId, theme, count || 5);
  }

  /**
   * GET /puzzle/room/:roomId
   * Returns all puzzles for a room, ordered by their sequence index.
   * Useful for debugging and for verifying what puzzles/answers were generated.
   */
  @Get('room/:roomId')
  async getPuzzles(@Param('roomId') roomId: string) {
    return this.puzzleService.getPuzzlesByRoom(roomId);
  }

  /**
   * POST /puzzle/submit-answer
   * Validates a submitted answer against the stored answer for a puzzle.
   * Returns whether the answer was correct and the next puzzle in sequence, if any.
   */
  @Post('submit-answer')
  async submitAnswer(
    @Body('puzzleId') puzzleId: string,
    @Body('answer') answer: string,
  ) {
    return this.puzzleService.submitAnswer(puzzleId, answer);
  }
}
