import { Injectable } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../environments/environment';

// Centralized wrapper around the Socket.io client connection.
// Kept as a single injectable service (rather than creating sockets inside components)
// so the same connection persists across page navigations (Home -> Waiting Room -> Game)
// instead of reconnecting on every route change.
@Injectable({
  providedIn: 'root',
})
export class SocketService {
  private socket: Socket;
  private readonly SERVER_URL = environment.apiUrl;

  constructor() {
    this.socket = io(this.SERVER_URL);

    // Debug logs to make connection issues visible in the browser console during development.
    // Useful for quickly telling apart "socket never connected" vs "event never reached the server".
    this.socket.on('connect', () => {
      console.log('✅ Socket connected:', this.socket.id);
    });

    this.socket.on('disconnect', () => {
      console.log('❌ Socket disconnected');
    });

    this.socket.on('connect_error', (err) => {
      console.log('⚠️ Socket connection error:', err.message);
    });
  }

  /**
   * Sends an event with a payload to the backend over the socket connection.
   * Used for all outgoing game actions (joining a room, starting the game, submitting an answer).
   */
  emit(event: string, data: any): void {
    console.log('📤 Emitting event:', event, data);
    this.socket.emit(event, data);
  }

  /**
   * Registers a listener for a given event coming from the backend.
   * Components call this to react to real-time updates (new puzzle, timer tick, game over, etc.).
   */
  on(event: string, callback: (data: any) => void): void {
    this.socket.on(event, callback);
  }

  /**
   * Removes a listener for a given event. Important to call in a component's ngOnDestroy
   * to prevent duplicate listeners from stacking up if the component is created again
   * (e.g. navigating away and back to the same page).
   */
  off(event: string): void {
    this.socket.off(event);
  }

  /**
   * Registers a callback specifically for reconnection events - fires whenever
   * the socket establishes (or re-establishes) a connection, including the very
   * first connection and any connection after a drop. Components use this to
   * resync their state whenever connectivity is (re)gained.
   */
  onConnect(callback: () => void): void {
    this.socket.on('connect', callback);
  }

  getSocketId(): string {
    return this.socket.id || '';
  }
}
