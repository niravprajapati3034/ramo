import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { AnswerFormDto } from './game.form';
import { PuzzleData } from './dto/game.dto';
import { ActivatedRoute, Router } from '@angular/router';
import { SocketService } from '../../services/socket.service';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';

// Main gameplay screen. Displays the current puzzle, countdown timer, and traitor
// status, and handles answer submission. All game state here is driven entirely by
// real-time Socket.io events broadcast from the backend - this component has no
// direct control over game logic, it just reflects whatever the server says is happening.
@Component({
  selector: 'app-game',
  imports: [CommonModule, ReactiveFormsModule, MatButtonModule, MatInputModule, MatFormFieldModule],
  templateUrl: './game.html',
  styleUrl: './game.scss',
})
export class Game implements OnInit, OnDestroy {
  roomCode = '';
  nickname = '';
  isTraitor = false;

  currentPuzzle: PuzzleData | null = null;
  totalPuzzles = 5;
  timeLeft = 0; // seconds, synced from server

  gameOver = false;
  gameOutcome: 'won' | 'lost' | null = null;
  gameMessage = '';

  wrongAnswerFlash = false;
  wrongAnswerMessage = '';
  lastCorrectBy = '';

  answerDto: AnswerFormDto;

  // Reference to the local countdown interval, so it can be cleared and restarted cleanly
  private countdownInterval: any;

  constructor(
    private route: ActivatedRoute,
    private socketService: SocketService,
    private fb: FormBuilder,
    private cdr: ChangeDetectorRef,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.roomCode = this.route.snapshot.paramMap.get('roomCode') || '';
    this.nickname = sessionStorage.getItem('nickname') || '';

    this.answerDto = new AnswerFormDto(this.fb).get({ answer: '' });

    this.registerSocketListeners();
  }

  ngOnDestroy(): void {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
    }

    // Clean up all listeners registered by this component to avoid duplicate
    // handlers if the Game page is revisited later in the same session.
    this.socketService.off('traitorAssigned');
    this.socketService.off('newPuzzle');
    this.socketService.off('timerStarted');
    this.socketService.off('answerCorrect');
    this.socketService.off('answerWrong');
    this.socketService.off('gameComplete');
    this.socketService.off('playerDisconnected');
  }

  /**
   * Registers listeners for every real-time event that can occur during gameplay.
   * Each handler calls detectChanges() manually since Socket.io callbacks run
   * outside Angular's zone and wouldn't otherwise trigger a view update immediately.
   */
  private registerSocketListeners(): void {
    const myPlayerId = sessionStorage.getItem('playerId');

    // Whenever this socket connects (including reconnecting after the browser tab
    // was closed/suspended and reopened later), ask the backend for the current
    // room state. Without this, if a player disconnects mid-game and comes back,
    // their screen stays frozen showing whatever was on screen before the drop -
    // this keeps it in sync with what actually happened on the server while they were away.
    this.socketService.onConnect(() => {
      const roomId = sessionStorage.getItem('roomId') || '';
      if (this.roomCode && roomId) {
        this.socketService.emit('resyncRoom', {
          roomCode: this.roomCode,
          roomId,
        });
      }
    });

    this.socketService.on('traitorAssigned', (data: { traitorPlayerId: string }) => {
      // Compare against this player's own id to determine if THEY are the traitor,
      // even though the event is currently broadcast to everyone in the room.
      this.isTraitor = data.traitorPlayerId === myPlayerId;
      this.cdr.detectChanges();
    });

    this.socketService.on('newPuzzle', (data: PuzzleData) => {
      this.currentPuzzle = data;
      if (data.totalPuzzles) {
        this.totalPuzzles = data.totalPuzzles;
      }
      // Reset the answer form so the previous puzzle's input doesn't carry over
      this.answerDto = new AnswerFormDto(this.fb).get({ answer: '' });
      this.wrongAnswerMessage = '';
      this.cdr.detectChanges();
    });

    // The server sends a single fixed end timestamp instead of a per-second countdown.
    // Each client calculates its own remaining time locally every second based on
    // (endTime - now), which stays smooth and accurate regardless of network latency -
    // a player far from the server will never see the timer jump backward, since the
    // calculation never depends on receiving a message at exactly the right moment.
    this.socketService.on('timerStarted', (data: { endTime: number }) => {
      if (this.countdownInterval) {
        clearInterval(this.countdownInterval);
      }

      this.countdownInterval = setInterval(() => {
        const secondsLeft = Math.max(0, Math.round((data.endTime - Date.now()) / 1000));
        this.timeLeft = secondsLeft;
        this.cdr.detectChanges();

        if (secondsLeft <= 0) {
          clearInterval(this.countdownInterval);
        }
      }, 1000);
    });

    this.socketService.on('answerCorrect', (data: { nickname: string }) => {
      this.lastCorrectBy = data.nickname;
      this.wrongAnswerMessage = '';
      this.cdr.detectChanges();
    });

    this.socketService.on('answerWrong', () => {
      // Show a brief error message and shake animation on the input,
      // then automatically clear it after 2 seconds.
      this.wrongAnswerMessage = 'Wrong answer, try again!';
      this.wrongAnswerFlash = true;
      this.cdr.detectChanges();

      setTimeout(() => {
        this.wrongAnswerFlash = false;
        this.wrongAnswerMessage = '';
        this.cdr.detectChanges();
      }, 2000);
    });

    this.socketService.on('gameComplete', (data: { outcome: 'won' | 'lost'; message: string }) => {
      // Switches the view from the active puzzle screen to the win/loss summary screen
      if (this.countdownInterval) {
        clearInterval(this.countdownInterval);
      }
      this.gameOver = true;
      this.gameOutcome = data.outcome;
      this.gameMessage = data.message;
      this.cdr.detectChanges();
    });

    this.socketService.on('playerDisconnected', (data: { nickname: string }) => {
      // Logged for now; could be surfaced as an in-game toast/banner in a future iteration
      console.log(`${data.nickname} disconnected`);
    });
  }

  /**
   * Submits the player's answer for the current puzzle over the socket connection.
   * The backend validates it and broadcasts the result (answerCorrect/answerWrong)
   * to the room - this method doesn't know or decide whether the answer is correct.
   */
  onSubmitAnswer(): void {
    if (this.answerDto.form.invalid || !this.currentPuzzle) return;

    this.socketService.emit('submitAnswer', {
      roomCode: this.roomCode,
      puzzleId: this.currentPuzzle.puzzleId,
      answer: this.answerDto.form.value.answer,
      nickname: this.nickname,
    });
  }

  // Clears session data and navigates back to the home page to start a fresh game
  onBackToHome(): void {
    sessionStorage.removeItem('roomId');
    sessionStorage.removeItem('playerId');
    sessionStorage.removeItem('nickname');
    this.router.navigate(['/']);
  }

  // Converts raw seconds into a MM:SS format for the timer display
  formatTime(totalSeconds: number): string {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }
}
