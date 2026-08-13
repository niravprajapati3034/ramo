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
    const prompt = `You are creating a fun, EXCITING escape room puzzle sequence for a "${theme}" themed game aimed at school-age students (ages 10-16). The puzzles must be EASY enough to solve in 1-2 minutes, but should still feel clever, surprising, and satisfying to solve - like a genuine "aha!" moment, not a boring worksheet question.

Generate exactly ${count} puzzles in a JSON array. Use a mix of these puzzle types, keeping them SIMPLE but making the presentation exciting and immersive:
- Simple word riddle where the answer is a single, common object or animal, described through 2-3 clear, unambiguous clues (e.g. "I have four legs, a long tail, and I bark - what am I?" → dog). AVOID riddles based on letter patterns, wordplay, or "which word fits this rule" - those often have multiple valid answers. The riddle must point to exactly ONE possible answer with no ambiguity.
- Basic anagram: rearrange 5-8 letters to form a COMMON, everyday word a 10-year-old would instantly recognize (e.g. "table", "apple", "happy", "school", "river", "smile" - NOT rare or unusual words). Make the anagram feel like a "secret code" the character just cracked.
- Simple Caesar cipher (shift by a small, consistent number like 1, 2, or 3, message under 8 words) - frame it as a spy message, secret note, or villain's code
- Easy arithmetic riddle (single-step addition/subtraction, small numbers under 50) - frame it as cracking a lock combination, a countdown, or a dramatic ticking clock moment
- Simple "spot the pattern" with an obvious, single-step pattern - frame it as decoding a hidden signal or ancient clue

HOW TO MAKE IT FEEL EXCITING (very important):
- Write vivid, dramatic narration that makes the student feel like a detective/hero in the story
- Use sensory, cinematic details (e.g. "the room goes dark", "a red light blinks", "footsteps echo closer")
- Make the puzzle feel like a genuine discovery, not a math homework question
- The DIFFICULTY should stay easy, but the PRESENTATION and STORY should feel thrilling

DIFFICULTY RULE: Every puzzle must be solvable through ONE simple step of reasoning - no combining multiple calculations or logic steps. Simplicity is about how HARD the puzzle is to solve, not how exciting it feels - keep the excitement, keep the ease.

CRITICAL - VERIFY YOUR OWN ANSWER: Solve each puzzle yourself step by step before finalizing it, and confirm the answer is unambiguous and correct - there must be exactly ONE possible correct answer, with no reasonable alternative answers.

CRITICAL - USE ONLY COMMON WORDS: Every word-based answer must be something a 10-year-old uses in everyday conversation.

BANNED - DO NOT USE:
- Any riddle with the answer "tomorrow"
- Multi-step math word problems
- Ciphers longer than 8 words
- Rare, unusual, technical, or archaic words as answers
- Flat, boring narration (e.g. "Solve this math problem") - always frame it as part of the story
- Letter-pattern riddles like "my last letter is my first" or "I contain double letters" - these often have multiple correct answers and confuse the answer-checking system

ANSWER FORMAT RULES (very important):
- Always use lowercase letters and numbers only in the "answer" field
- NO spaces, NO colons, NO punctuation, NO symbols
- For number answers, just the digits (e.g. "24" not "twenty-four")
- For word answers, single word, no spaces

Each puzzle must have:
- "question": the puzzle text (clear, but framed dramatically within the story)
- "answer": the correct answer (following the format rules above)
- "hint": a helpful, encouraging hint
- "narration": a vivid, exciting 1-2 sentence story moment for this puzzle, tailored to the "${theme}" theme

Puzzles should get slightly harder from puzzle 1 to puzzle ${count}, but ALL of them should remain easy enough for a school student.

Respond ONLY with valid JSON array, no markdown, no extra text. Format:
[{"question": "...", "answer": "...", "hint": "...", "narration": "..."}]`;

    const completion = await this.groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7, // Slightly lower than before - favors reliability/correctness over creativity
    });

    const rawResponse = completion.choices[0].message.content;
    const cleaned = rawResponse.replace(/```json|```/g, '').trim();
    const puzzlesData = JSON.parse(cleaned);

    const room = await this.roomRepo.findOne({ where: { id: roomId } });
    if (!room) {
      throw new Error('Room not found');
    }

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
