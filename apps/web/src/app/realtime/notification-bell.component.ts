import { ChangeDetectionStrategy, Component, ElementRef, inject, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { NotificationItem, NotificationsService } from './notifications.service';
import { actorName, describeEvent, relativeTime } from './activity';

@Component({
  selector: 'app-notification-bell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './notification-bell.component.html',
  styleUrl: './notification-bell.component.scss',
})
export class NotificationBellComponent {
  private readonly router = inject(Router);
  readonly store = inject(NotificationsService);
  private readonly panel = viewChild.required<ElementRef<HTMLElement>>('panel');

  readonly describe = describeEvent;
  readonly actorName = actorName;
  readonly relativeTime = relativeTime;

  constructor() {
    this.store.refresh();
  }

  toggle(): void {
    const panel = this.panel().nativeElement;
    if (panel.matches(':popover-open')) {
      panel.hidePopover();
      return;
    }
    this.store.refresh();
    panel.showPopover();
  }

  open(item: NotificationItem): void {
    this.panel().nativeElement.hidePopover();
    // The card id is passed along so the board can open that card's modal directly.
    void this.router.navigate(['/boards', item.boardId], {
      queryParams: item.cardId ? { card: item.cardId } : {},
    });
  }
}
