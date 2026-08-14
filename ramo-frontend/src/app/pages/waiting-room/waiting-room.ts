import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { Player } from './dto/waiting-room.dto';
import { ActivatedRoute, Router } from '@angular/router';
import { RoomService } from '../../services/room.service';
import { SocketService } from '../../services/socket.service';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

// Lobby screen shown after creating/joining a room. Displays the live player list
// as others join in real time, and lets any player start the game once at least
// 2 players are present. On game start, all players are redirected to the Game page.
@Component({
  selector: 'app-waiting-room',
  imports: [CommonModule, MatButtonModule, MatIconModule],
  templateUrl: './waiting-room.html',
  styleUrl: './waiting-room.scss',
})
export class WaitingRoom implements OnInit, OnDestroy {
  roomCode = '';
  roomId = '';
  playerId = '';
  nickname = '';
  theme = 'heist';

  players: Player[] = [];
  isStarting = false;
  errorMessage = '';

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private roomService: RoomService,
    private socketService: SocketService,
    private cdr: ChangeDetectorRef, // Used to manually trigger change detection for socket events
  ) {}

  ngOnInit(): void {
    this.loadPlayerSession();

    if (!this.hasValidSession()) {
      this.redirectToHome();
      return;
    }

    this.loadRoomDetails();
    this.registerSocketListeners();
    this.joinSocketRoom();
  }

  /**
   * Reads the room code from the URL and the player's identity from sessionStorage.
   * sessionStorage is tab-specific, so this will come back empty if the player opened
   * this room URL in a fresh tab (e.g. copy-pasted the link) instead of going through
   * the proper create/join flow on the Home page.
   */
  private loadPlayerSession(): void {
    this.roomCode = this.route.snapshot.paramMap.get('roomCode') || '';
    this.roomId = sessionStorage.getItem('roomId') || '';
    this.playerId = sessionStorage.getItem('playerId') || '';
    this.nickname = sessionStorage.getItem('nickname') || '';
  }

  /**
   * Checks whether this tab has a valid player identity to participate in the room.
   * Without this, the player would silently join the Socket.io room with an empty
   * nickname and no backend Player record, showing up as a "ghost" entry in the player list.
   */
  private hasValidSession(): boolean {
    return !!this.roomId && !!this.playerId && !!this.nickname;
  }

  /**
   * Redirects back to Home with the room code pre-filled, so the player can properly
   * join by entering a nickname instead of ending up in a broken, identity-less state.
   */
  private redirectToHome(): void {
    this.router.navigate(['/'], { queryParams: { roomCode: this.roomCode } });
  }

  /**
   * Joins the Socket.io room so this client starts receiving real-time updates
   * for this specific room (other players joining, game starting, etc.).
   */
  private joinSocketRoom(): void {
    this.socketService.emit('joinRoom', {
      roomCode: this.roomCode,
      playerId: this.playerId,
      nickname: this.nickname,
    });
  }

  ngOnDestroy(): void {
    // Remove listeners when leaving this page to prevent duplicate handlers
    // if the component is recreated later (e.g. navigating back to a waiting room).
    this.socketService.off('playerJoined');
    this.socketService.off('gameStarted');
    this.socketService.off('startGameError');
  }

  /**
   * Fetches the room's current details and player list via HTTP.
   * This gives us the initial state; any players who join after this point
   * are picked up in real time through the 'playerJoined' socket event instead.
   */
  private loadRoomDetails(): void {
    this.roomService.getRoomByCode(this.roomCode).subscribe({
      next: (room) => {
        this.theme = room.theme;
        this.players = room.players;
        this.cdr.detectChanges(); // Force view update after HTTP response
      },
      error: () => {
        this.errorMessage = 'Could not load room details.';
        this.cdr.detectChanges();
      },
    });
  }

  /**
   * Registers listeners for all real-time events relevant to the waiting room:
   * new players joining, the game starting (triggers navigation to the Game page),
   * and any error that occurs when trying to start the game.
   */
  private registerSocketListeners(): void {
    this.socketService.on('playerJoined', (data: { playerId: string; nickname: string }) => {
      // Guard against adding a duplicate entry if this event fires for a player
      // already reflected in the initial HTTP-loaded list.
      const alreadyInList = this.players.some((p) => p.id === data.playerId);
      if (!alreadyInList) {
        this.players.push({ id: data.playerId, nickname: data.nickname });
      }
      // Socket events run outside Angular's zone, so we manually trigger change detection
      // to update the view immediately instead of waiting for the next unrelated UI event.
      this.cdr.detectChanges();
    });

    this.socketService.on('gameStarted', () => {
      // Once the backend confirms the game has started, every player in the room
      // is redirected to the Game page to begin solving puzzles.
      this.router.navigate(['/game', this.roomCode]);
      this.cdr.detectChanges();
    });

    this.socketService.on('startGameError', (data: { message: string }) => {
      // e.g. "Need at least 2 players to start" - shown only to the player who tried to start
      this.isStarting = false;
      this.errorMessage = data.message;
      this.cdr.detectChanges();
    });
  }

  /**
   * Triggered when the player clicks "Start Game". Requires at least 2 players
   * in the room (enforced here on the frontend for immediate feedback, and again
   * on the backend as the source of truth).
   */
  onStartGame(): void {
    this.isStarting = true;
    this.errorMessage = '';

    this.socketService.emit('startGame', {
      roomId: this.roomId,
      roomCode: this.roomCode,
      theme: this.theme,
    });
  }

  // Copies the room code to the clipboard so it can be easily shared with other players
  copyRoomCode(): void {
    navigator.clipboard.writeText(this.roomCode);
  }
}
