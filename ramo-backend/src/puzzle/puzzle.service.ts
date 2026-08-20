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
    //     const prompt = `You are creating a fun, EXCITING escape room puzzle sequence for a "${theme}" themed game aimed at school-age students (ages 10-16). The puzzles must be EASY enough to solve in 1-2 minutes, but should still feel clever, surprising, and satisfying to solve - like a genuine "aha!" moment, not a boring worksheet question.

    // Generate exactly ${count} puzzles in a JSON array. Use a mix of these puzzle types, keeping them SIMPLE but making the presentation exciting and immersive:
    // - Simple word riddle where the answer is a single, common object or animal, described through 2-3 clear, unambiguous clues (e.g. "I have four legs, a long tail, and I bark - what am I?" → dog). AVOID riddles based on letter patterns, wordplay, or "which word fits this rule" - those often have multiple valid answers. The riddle must point to exactly ONE possible answer with no ambiguity.
    // - Basic anagram: rearrange EXACTLY 5-6 letters (never fewer than 5, never more than 6) to form a COMMON, everyday word a 10-year-old would say in daily conversation (e.g. "table", "apple", "happy", "smile", "beach", "candy", "pizza", "mouse", "chair" - NOT rare, technical, or unusual words like "alto", "iota", "oral", "spat"). Before finalizing, ask: could a 10-year-old say this word out loud casually? If not, pick a different, more common word. Make the anagram feel like a "secret code" the character just cracked.
    // - Simple Caesar cipher (shift by a small, consistent number like 1, 2, or 3, message under 8 words) - frame it as a spy message, secret note, or villain's code. Do NOT reuse the classic "khoor zruog" example (which is "hello world" shifted by 3) - it is overused. Pick a different short, fun message. CRITICAL: after choosing your shift number and encoding a message, manually re-decode your own encoded message letter-by-letter using that exact shift number to confirm it produces the correct plain-text message before writing it in the puzzle. The shift number you state in the question text MUST match the shift number you actually used to encode it.
    // - Easy arithmetic riddle (single-step addition/subtraction, small numbers under 50) - frame it as cracking a lock combination, a countdown, or a dramatic ticking clock moment
    // - Simple "spot the pattern" with an obvious, single-step pattern - frame it as decoding a hidden signal or ancient clue

    // HOW TO MAKE IT FEEL EXCITING (very important):
    // - Write vivid, dramatic narration that makes the student feel like a detective/hero in the story
    // - Use sensory, cinematic details (e.g. "the room goes dark", "a red light blinks", "footsteps echo closer")
    // - Make the puzzle feel like a genuine discovery, not a math homework question
    // - The DIFFICULTY should stay easy, but the PRESENTATION and STORY should feel thrilling

    // HUMOR AND FUN (very important):
    // - Sprinkle in light humor and playful, silly details wherever it fits naturally - funny character names, silly sound effects in the narration, a joke the "villain" makes, or a comically over-the-top dramatic moment
    // - Think of the tone like a fun kids' adventure movie or a silly heist comedy, NOT a serious thriller
    // - It's okay to be a little goofy - e.g. a security guard who's obsessed with snacks, a villain who monologues too much, a lock that "burps" when it opens
    // - The goal is that a student playing this for fun should smile or laugh at least once per puzzle, not just solve it

    // DIFFICULTY RULE: Every puzzle must be solvable through ONE simple step of reasoning - no combining multiple calculations or logic steps. Simplicity is about how HARD the puzzle is to solve, not how exciting it feels - keep the excitement, keep the ease.

    // CRITICAL - VERIFY YOUR OWN ANSWER: Solve each puzzle yourself step by step before finalizing it, and confirm the answer is unambiguous and correct - there must be exactly ONE possible correct answer, with no reasonable alternative answers.

    // CRITICAL - USE ONLY COMMON WORDS: Every word-based answer must be something a 10-year-old uses in everyday conversation.

    // BANNED - DO NOT USE:
    // - Any riddle with the answer "tomorrow"
    // - Multi-step math word problems
    // - Ciphers longer than 8 words
    // - Rare, unusual, technical, or archaic words as answers
    // - Flat, boring narration (e.g. "Solve this math problem") - always frame it as part of the story
    // - Letter-pattern riddles like "my last letter is my first" or "I contain double letters" - these often have multiple correct answers and confuse the answer-checking system

    // ANSWER FORMAT RULES (very important):
    // - Always use lowercase letters and numbers only in the "answer" field
    // - NO spaces, NO colons, NO punctuation, NO symbols
    // - For number answers, just the digits (e.g. "24" not "twenty-four")
    // - For word answers, single word, no spaces

    // Each puzzle must have:
    // - "question": the puzzle text (clear, but framed dramatically and with a touch of humor within the story)
    // - "answer": the correct answer (following the format rules above)
    // - "hint": a helpful, encouraging, and slightly funny hint
    // - "narration": a vivid, exciting, and playful 1-2 sentence story moment for this puzzle, tailored to the "${theme}" theme

    // Puzzles should get slightly harder from puzzle 1 to puzzle ${count}, but ALL of them should remain easy enough for a school student.

    // Respond ONLY with valid JSON array, no markdown, no extra text. Format:
    // [{"question": "...", "answer": "...", "hint": "...", "narration": "..."}]`;

    const prompt = `You are creating a fun escape room puzzle sequence for a "${theme}" themed game aimed at school students in grades 5-10 (ages 10-16). Puzzles can involve up to TWO simple, connected steps of thinking, but must remain solvable within 1-2 minutes without needing pen and paper.

Generate exactly ${count} puzzles in a JSON array. Use a mix of these puzzle types:
- Clever word riddle where the answer is a common object, animal, or place, described through 2-4 clues that require a bit of connecting-the-dots (e.g. "I have hands but no arms, I have a face but no eyes, and I tell you when to leave for school - what am I?" → clock)
- Two-step arithmetic (e.g. "double 6, then add 5" - numbers under 100, at most 2 simple operations)
- Basic anagram: rearrange EXACTLY 5-7 letters to form a COMMON, everyday word a 12-year-old would recognize instantly (e.g. "table", "school", "planet", "garden", "pencil" - NOT rare or unusual words)
-CRITICAL FOR ANAGRAMS: After picking your answer word, write out its exact letters, then scramble ONLY those exact letters (same letters, different order) to create the puzzle. Do NOT substitute or change any letter. Before finalizing, verify that the scrambled letters you show the player are EXACTLY the same letters (same count of each letter) as your answer word - no more, no less, no different letters.
- Simple logic riddle with 2-3 short clues about people/objects (e.g. "there are 3 boxes, only one has treasure, the middle box is empty, the treasure is not on the left - which box has it?")
- "Spot the pattern" with a slightly less obvious rule (e.g. skip-counting, or a simple multiply-then-add sequence)

DIFFICULTY RULE: Puzzles may require up to 2 connected steps of reasoning, but never more than 2. If a puzzle needs 3+ steps or feels like it requires a calculator/paper, simplify it.

HOW TO MAKE IT FEEL FUN:
- Write vivid, dramatic narration (1-2 sentences) using the "${theme}" setting, with sensory details
- Add light humor - funny character names, silly moments, or a playful twist
- Make it feel like an exciting mini-adventure, not homework

CRITICAL - VERIFY YOUR OWN ANSWER: Solve each puzzle yourself step by step before finalizing it. Confirm there is exactly ONE possible correct answer with no ambiguity - re-check any math or logic puzzle twice.

CRITICAL - USE ONLY COMMON WORDS: Every word-based answer must be something a 12-year-old uses in everyday conversation.

BANNED - DO NOT USE:
- Any riddle with the answer "tomorrow"
- Ciphers or letter-shifting codes of any kind
- Letter-pattern riddles like "my last letter is my first"
- Puzzles requiring more than 2 reasoning steps
- Rare, unusual, or technical words as answers

ANSWER FORMAT RULES (very important):
- Lowercase letters and numbers only, no spaces, no punctuation
- For number answers, just the digits (e.g. "23")
- For word answers, a single common word, no spaces
- For logic riddles about choices (like "which box"), use the option label as the answer (e.g. "middle", "left", "right", or a name)

Each puzzle must have:
- "question": the puzzle text (clear, friendly language, framed within the story)
- "answer": the correct answer (following format rules)
- "hint": a helpful, encouraging hint
- "narration": a vivid, dramatic 1-2 sentence story moment tailored to the "${theme}" theme

Puzzles should get progressively harder from puzzle 1 to puzzle ${count}.

Respond ONLY with valid JSON array, no markdown, no extra text. Format:
[{"question": "...", "answer": "...", "hint": "...", "narration": "..."}]`;

    const completion = await this.groq.chat.completions.create({
      model: 'openai/gpt-oss-120b',
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

    // Guard against duplicate submissions racing in (e.g. from rapid double-clicks
    // or network retries) - if this puzzle was already solved by an earlier request
    // a moment ago, don't process it again and don't advance the sequence a second
    // time. Without this, rapid clicks could skip multiple puzzles in one go.
    if (puzzle.solved) {
      const nextPuzzle = await this.puzzleRepo.findOne({
        where: {
          room: { id: puzzle.room.id },
          orderIndex: puzzle.orderIndex + 1,
        },
      });
      return { correct: true, nextPuzzle: nextPuzzle || null };
    }

    const normalizedSubmitted = this.normalize(submittedAnswer);
    const normalizedStored = this.normalize(puzzle.answer);

    const isCorrect = normalizedSubmitted === normalizedStored;

    if (isCorrect) {
      puzzle.solved = true;
      await this.puzzleRepo.save(puzzle);

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
