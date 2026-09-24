import { DestroyRef, Injectable, effect, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Subject } from 'rxjs';
import { AuthService } from '../auth/auth.service';

export interface StreamMessage {
  id: string;
  type: string;
  boardId: string;
  cardId: string | null;
  actorId: string;
  actorEmail: string;
  data: Record<string, unknown>;
  createdAt: string;
  /** True when this message also created a notification for the current user. */
  notified: boolean;
}

const BASE_RETRY_MS = 1000;
const MAX_RETRY_MS = 30_000;

/**
 * Live board updates over Server-Sent Events.
 *
 * SSE rather than WebSockets because every write already goes through REST: the only
 * missing direction is server to client, which is exactly what EventSource does natively,
 * with reconnection built in and no client library. See docs/adr/0002.
 */
@Injectable({ providedIn: 'root' })
export class RealtimeService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  private source: EventSource | null = null;
  private retryMs = BASE_RETRY_MS;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Guards against a reconnect scheduled by a connection we have already replaced. */
  private generation = 0;

  private readonly messages = new Subject<StreamMessage>();
  readonly events = this.messages.asObservable();
  readonly connected = signal(false);

  constructor() {
    // One connection per session, opened on login and torn down on logout.
    effect(() => (this.auth.isAuthenticated() ? this.connect() : this.disconnect()));
    inject(DestroyRef).onDestroy(() => this.disconnect());
  }

  private connect(): void {
    if (this.source) return;
    const generation = ++this.generation;

    // EventSource cannot carry an Authorization header, so the stream is opened with a
    // short-lived single-purpose ticket instead of the access token.
    this.http.post<{ ticket: string }>('/events/ticket', {}).subscribe({
      next: ({ ticket }) => {
        if (generation !== this.generation) return;
        const source = new EventSource(`/events/stream?ticket=${encodeURIComponent(ticket)}`);
        this.source = source;

        source.onopen = () => {
          this.retryMs = BASE_RETRY_MS;
          this.connected.set(true);
        };
        source.onmessage = (event) => {
          const message = JSON.parse(event.data) as StreamMessage | { type: 'ping' };
          if (message.type !== 'ping') this.messages.next(message as StreamMessage);
        };
        // The ticket is single-use and expires in 60s, so the browser's own retry would
        // just 401 forever. Take over: tear down and reconnect with a fresh ticket.
        source.onerror = () => {
          this.connected.set(false);
          if (generation !== this.generation) return;
          this.teardown();
          this.scheduleReconnect();
        };
      },
      error: () => {
        if (generation === this.generation) this.scheduleReconnect();
      },
    });
  }

  private scheduleReconnect(): void {
    if (this.retryTimer || !this.auth.isAuthenticated()) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, MAX_RETRY_MS);
  }

  private teardown(): void {
    this.source?.close();
    this.source = null;
  }

  private disconnect(): void {
    this.generation++;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.retryMs = BASE_RETRY_MS;
    this.teardown();
    this.connected.set(false);
  }
}
