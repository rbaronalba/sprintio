import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import { RealtimeService } from './realtime.service';
import { ActivityActor } from './activity';

export interface NotificationItem {
  id: string;
  readAt: string | null;
  createdAt: string;
  type: string;
  boardId: string;
  cardId: string | null;
  actor: ActivityActor;
  data: Record<string, unknown>;
}

@Injectable({ providedIn: 'root' })
export class NotificationsService {
  private readonly http = inject(HttpClient);
  private readonly realtime = inject(RealtimeService);

  readonly unread = signal(0);
  readonly items = signal<NotificationItem[]>([]);

  constructor() {
    this.realtime.events
      .pipe(
        filter((message) => message.notified),
        takeUntilDestroyed(),
      )
      // Bump the count now for instant feedback; the list itself is fetched when the
      // bell is opened, so the item is rendered from one source of truth, not two.
      .subscribe(() => this.unread.update((n) => n + 1));
  }

  refresh(): void {
    this.http
      .get<{ unread: number; items: NotificationItem[] }>('/notifications')
      .subscribe(({ unread, items }) => {
        this.unread.set(unread);
        this.items.set(items);
      });
  }

  markAllRead(): void {
    if (this.unread() === 0) return;
    this.http.post('/notifications/read', {}).subscribe(() => {
      this.unread.set(0);
      const readAt = new Date().toISOString();
      this.items.update((items) => items.map((n) => ({ ...n, readAt: n.readAt ?? readAt })));
    });
  }
}
