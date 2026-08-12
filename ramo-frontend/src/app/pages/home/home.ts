import { Component, OnInit } from '@angular/core';
import { CreateRoomFormDto } from './create.room.form';
import { JoinRoomFormDto } from './join.room.form';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { RoomService } from '../../services/room.service';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatCardModule } from '@angular/material/card';

// Landing page where a player either creates a new room or joins an existing one
// using a room code. Successfully creating/joining stores the player's identity in
// sessionStorage and navigates to the Waiting Room screen.
@Component({
  selector: 'app-home',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatInputModule,
    MatFormFieldModule,
    MatSelectModule,
    MatCardModule,
  ],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home implements OnInit {
  createRoomDto: CreateRoomFormDto;
  joinRoomDto: JoinRoomFormDto;

  isLoading = false;
  errorMessage = '';

  themes = ['heist', 'horror', 'comedy', 'sci-fi'];

  // Constructor is only used for dependency injection - no logic here
  constructor(
    private fb: FormBuilder,
    private roomService: RoomService,
    private router: Router,
    private route: ActivatedRoute,
  ) {}

  // All initialization logic (form creation, default values) goes in ngOnInit
  ngOnInit(): void {
    this.initializeForms();
  }

  /**
   * Sets up both forms used on this page: the Create Room form with default values,
   * and the Join Room form - pre-filled with a room code if the player was redirected
   * here from an invalid/expired room link (e.g. opening a room URL in a new tab
   * without going through the proper join flow).
   */
  private initializeForms(): void {
    this.createRoomDto = new CreateRoomFormDto(this.fb).get({ nickname: '', theme: 'heist' });

    const roomCodeFromQuery = this.route.snapshot.queryParamMap.get('roomCode') || '';
    this.joinRoomDto = new JoinRoomFormDto(this.fb).get({
      nickname: '',
      roomCode: roomCodeFromQuery,
    });
  }

  /**
   * Creates a new room with the selected theme, then immediately joins it as the
   * first player (this creates the Player record in the backend), and finally
   * navigates to the Waiting Room so the player can wait for others to join.
   */
  onCreateRoom(): void {
    if (this.createRoomDto.form.invalid) return;

    this.isLoading = true;
    this.errorMessage = '';

    const { nickname, theme } = this.createRoomDto.form.value;

    this.roomService.createRoom(theme).subscribe({
      next: (room) => {
        this.roomService.joinRoom(room.roomCode, nickname).subscribe({
          next: (player) => {
            this.isLoading = false;
            this.navigateToWaitingRoom(room.roomCode, room.id, player.id, nickname);
          },
          error: () => {
            this.isLoading = false;
            this.errorMessage = 'Failed to join the room you just created. Please try again.';
          },
        });
      },
      error: () => {
        this.isLoading = false;
        this.errorMessage = 'Failed to create room. Please try again.';
      },
    });
  }

  /**
   * Joins an existing room using a room code shared by another player.
   * First verifies the room exists (getRoomByCode) before attempting to join,
   * so an invalid room code shows a clear error instead of a confusing join failure.
   */
  onJoinRoom(): void {
    if (this.joinRoomDto.form.invalid) return;

    this.isLoading = true;
    this.errorMessage = '';

    const { nickname, roomCode } = this.joinRoomDto.form.value;

    this.roomService.getRoomByCode(roomCode).subscribe({
      next: (room) => {
        this.roomService.joinRoom(roomCode, nickname).subscribe({
          next: (player) => {
            this.isLoading = false;
            this.navigateToWaitingRoom(roomCode, room.id, player.id, nickname);
          },
          error: () => {
            this.isLoading = false;
            this.errorMessage = 'Failed to join the room. Please check the room code.';
          },
        });
      },
      error: () => {
        this.isLoading = false;
        this.errorMessage = 'Room not found. Please check the room code.';
      },
    });
  }

  /**
   * Stores the player's identity (room id, player id, nickname) in sessionStorage
   * so subsequent pages (Waiting Room, Game) can identify this player without
   * needing to pass everything through route params. sessionStorage is used
   * instead of localStorage so this data is automatically cleared when the tab closes,
   * preventing stale identity data from leaking into a future session.
   */
  private navigateToWaitingRoom(
    roomCode: string,
    roomId: string,
    playerId: string,
    nickname: string,
  ): void {
    sessionStorage.setItem('roomId', roomId);
    sessionStorage.setItem('playerId', playerId);
    sessionStorage.setItem('nickname', nickname);

    this.router.navigate(['/waiting-room', roomCode]);
  }
}
