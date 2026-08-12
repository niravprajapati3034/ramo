import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

// Handles all HTTP calls to the backend REST API (room creation, joining, fetching details).
// These are one-time request/response calls used for initial setup; once a player is in
// a room, all further real-time updates flow through SocketService instead.
@Injectable({
  providedIn: 'root',
})
export class RoomService {
  private readonly API_URL = `${environment.apiUrl}/room`;

  constructor(private http: HttpClient) {}

  /**
   * Creates a new room with the given theme.
   * Returns the created room, including its generated room code and internal id.
   */
  createRoom(theme: string): Observable<any> {
    return this.http.post(`${this.API_URL}/create`, { theme });
  }

  /**
   * Joins an existing room using its room code and the player's chosen nickname.
   * This creates the Player record in the backend database.
   */
  joinRoom(roomCode: string, nickname: string): Observable<any> {
    return this.http.post(`${this.API_URL}/join`, { roomCode, nickname });
  }

  /**
   * Fetches a room's details (including its current player list) by room code.
   * Used to validate a room exists before joining, and to load the waiting room screen.
   */
  getRoomByCode(roomCode: string): Observable<any> {
    return this.http.get(`${this.API_URL}/${roomCode}`);
  }
}
