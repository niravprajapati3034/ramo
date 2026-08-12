import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Puzzle } from '../entities/puzzle.entity';
import { Room } from '../entities/room.entity';

// Groq SDK is imported using the CommonJS require() pattern instead of ES import,
// following this project's convention for third-party SDKs in NestJS.
const Groq = require('groq-sdk');

// Handles AI-powered puzzle generation (via Groq's LLM API) and answer validation.
// Each room gets a freshly generated, unique set of puzzles every time a game starts.
@Injectable()
export class PuzzleService {
  private groq: any;

  constructor(
    private configService: ConfigService,
    @InjectRepository(Puzzle)
    private puzzleRepo: Repository<Puzzle>,
    @InjectRepository(Room)
    private roomRepo: Repository<Room>,
  ) {
    this.groq = new Groq({
      apiKey: this.configService.get('GROQ_API_KEY'),
    });
  }

  /**
   * Generates a set of AI-created puzzles for a room using Groq's LLM.
   *
   * The prompt is carefully engineered to:
   * - Force variety across puzzle types (math, cipher, logic, anagram, spatial)
   *   so the AI doesn't default to the same overused riddles every time.
   * - Explicitly ban a few riddles the model kept repeating during testing
   *   (e.g. the "tomorrow" riddle), since LLMs tend to gravitate toward common trivia.
   * - Enforce a strict answer format (lowercase, no punctuation/spaces) so that
   *   answer checking later is predictable regardless of what type of puzzle it is.
   *
   * Once generated, the puzzles are parsed from the AI's JSON response and saved to the DB,
   * linked to the given room, in the order they should be presented to players.
   */
  async generatePuzzles(
    roomId: string,
    theme: string,
    count: number = 5,
  ): Promise<Puzzle[]> {
    const prompt = `You are a game master creating an escape room puzzle sequence for a "${theme}" themed game.

Generate exactly ${count} COMPLETELY DIFFERENT puzzles in a JSON array. Each puzzle MUST use a different puzzle type - mix these categories across the ${count} puzzles:
- Number sequence or math logic
- Cipher/code decoding (e.g. letter shift like Caesar cipher, symbol substitution)
- Logic deduction (e.g. "who did it" clue-based, three suspects one lied)
- Anagram or hidden word puzzle
- Spatial/visual pattern (e.g. arranging items, coordinates)

BANNED - DO NOT USE these overused riddles or answers under any circumstance:
- Any riddle with the answer "tomorrow"
- "What has keys but no locks" (piano/keyboard riddle)
- "What gets wetter as it dries" (towel riddle)
- Any riddle starting with "What am I" as a generic wordplay riddle

IMPORTANT: Do NOT repeat similar riddles or reuse the same answer/theme twice. Each puzzle must feel distinct and original, tailored specifically to a "${theme}" scenario - not a generic riddle pulled from common trivia.

For math/logic/number puzzles: solve the puzzle yourself step-by-step first, verify your answer is mathematically correct, THEN write the question. Double-check the answer matches the question exactly.

ANSWER FORMAT RULES (very important):
- Always use lowercase letters and numbers only in the "answer" field
- NO spaces, NO colons, NO punctuation, NO symbols in the "answer" field
- For time answers, use 24hr format without colon (e.g. "1530" not "3:30pm")
- For word answers, use single word or joined words without spaces (e.g. "masterkey" not "master key")
- For number sequences, just the digits (e.g. "3425" not "3-4-2-5")

Each puzzle must have:
- "question": the puzzle/riddle text
- "answer": the correct answer (following the format rules above)
- "hint": a helpful hint if players are stuck
- "displayHint": a short instruction telling the player exactly what format to type the answer in (e.g. "Enter as HHMM, like 0930" or "Enter as a single word" or "Enter as digits only, like 3425")
- "narration": a dramatic 1-2 sentence story text that sets the scene for this puzzle

Puzzles should get progressively harder. Theme: ${theme}.

Respond ONLY with valid JSON array, no markdown, no extra text. Format:
[{"question": "...", "answer": "...", "hint": "...", "displayHint": "...", "narration": "..."}]`;

    const completion = await this.groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 1.0, // Higher temperature encourages more varied, creative puzzle output
    });

    const rawResponse = completion.choices[0].message.content;

    // The model occasionally wraps its JSON response in markdown code fences,
    // so we strip those out before parsing to avoid JSON.parse errors.
    const cleaned = rawResponse.replace(/```json|```/g, '').trim();
    const puzzlesData = JSON.parse(cleaned);

    const room = await this.roomRepo.findOne({ where: { id: roomId } });
    if (!room) {
      throw new Error('Room not found');
    }

    // Convert the AI's raw puzzle data into Puzzle entities, normalizing each answer
    // at save time so it matches the same format used later during answer checking.
    const puzzles = puzzlesData.map((p: any, index: number) =>
      this.puzzleRepo.create({
        question: p.question,
        answer: this.normalize(p.answer),
        hint: p.hint,
        narration: p.narration,
        orderIndex: index + 1,
        room,
      }),
    );

    return this.puzzleRepo.save(puzzles);
  }

  /**
   * Fetches all puzzles belonging to a room, ordered by their sequence index.
   * Used when a player reconnects or when the game needs to resend the current puzzle state.
   */
  async getPuzzlesByRoom(roomId: string): Promise<Puzzle[]> {
    return this.puzzleRepo.find({
      where: { room: { id: roomId } },
      order: { orderIndex: 'ASC' },
    });
  }

  /**
   * Normalizes an answer string for comparison purposes: lowercases it and strips
   * spaces, colons, periods, hyphens, and commas.
   *
   * This exists because the AI doesn't always store answers in a perfectly consistent
   * format (e.g. a time answer might come back as "3:15" in one puzzle and "315" in
   * another), and a player might reasonably type "3:15", "315", or "3 15" for the
   * same answer. Normalizing both the stored answer and the submitted answer the
   * same way makes the comparison forgiving of these formatting differences.
   */
  private normalize(str: string): string {
    return str
      .toLowerCase()
      .replace(/[\s:.\-,]/g, '')
      .trim();
  }

  /**
   * Validates a submitted answer against the stored answer for a puzzle.
   * If correct, marks the puzzle as solved and returns the next puzzle in the
   * room's sequence (or null if this was the last puzzle, meaning the game is complete).
   */
  async submitAnswer(
    puzzleId: string,
    submittedAnswer: string,
  ): Promise<{ correct: boolean; nextPuzzle: Puzzle | null }> {
    const puzzle = await this.puzzleRepo.findOne({
      where: { id: puzzleId },
      relations: ['room'],
    });

    if (!puzzle) {
      throw new Error('Puzzle not found');
    }

    const normalizedSubmitted = this.normalize(submittedAnswer);
    const normalizedStored = this.normalize(puzzle.answer);

    const isCorrect = normalizedSubmitted === normalizedStored;

    if (isCorrect) {
      puzzle.solved = true;
      await this.puzzleRepo.save(puzzle);

      // Look up the next puzzle in this room's sequence, if one exists
      const nextPuzzle = await this.puzzleRepo.findOne({
        where: {
          room: { id: puzzle.room.id },
          orderIndex: puzzle.orderIndex + 1,
        },
      });

      return { correct: true, nextPuzzle: nextPuzzle || null };
    }

    return { correct: false, nextPuzzle: null };
  }
}
