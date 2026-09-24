import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  CdkDrag,
  CdkDragDrop,
  CdkDragHandle,
  CdkDropList,
  moveItemInArray,
  transferArrayItem,
} from '@angular/cdk/drag-drop';
import { Subject, debounceTime, filter } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ThemeToggleComponent } from '../theme-toggle/theme-toggle.component';
import { AuthService } from '../auth/auth.service';
import { NotificationBellComponent } from '../realtime/notification-bell.component';
import { RealtimeService } from '../realtime/realtime.service';
import { actorName, describeEvent, relativeTime } from '../realtime/activity';
import { ActivityEntry, BoardDetail, BoardsService, Label, Member } from './boards.service';
import { Attachment, BoardService, Card, ChecklistItem, Comment, List, TimeEntry } from './board.service';
import { positionAt } from './position';

// Mirrors the fixed palette the API accepts (apps/api/src/boards/dto.ts).
export const LABEL_COLORS = ['#c8102e', '#e08a1e', '#d9c22e', '#3f8f4f', '#2e7fd9', '#7a4fd9', '#6b7280'];

@Component({
  selector: 'app-board-detail',
  imports: [
    RouterLink,
    ThemeToggleComponent,
    NotificationBellComponent,
    CdkDropList,
    CdkDrag,
    CdkDragHandle,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './board-detail.component.html',
  styleUrl: './board-detail.component.scss',
})
export class BoardDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(BoardService);
  private readonly boardsApi = inject(BoardsService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly realtime = inject(RealtimeService);

  readonly describeEvent = describeEvent;
  readonly actorName = actorName;
  readonly relativeTime = relativeTime;

  readonly boardId = this.route.snapshot.paramMap.get('id')!;
  readonly lists = signal<List[]>([]);
  readonly board = signal<BoardDetail | null>(null);
  readonly members = computed(() => this.board()?.members ?? []);
  readonly labels = computed(() => this.board()?.labels ?? []);
  readonly labelColors = LABEL_COLORS;
  readonly pickedColor = signal(LABEL_COLORS[0]);
  readonly comments = signal<Comment[]>([]);
  readonly timeEntries = signal<TimeEntry[]>([]);
  readonly attachments = signal<Attachment[]>([]);
  readonly checklist = signal<ChecklistItem[]>([]);
  readonly activity = signal<ActivityEntry[]>([]);
  readonly live = this.realtime.connected;
  readonly currentUserId = this.auth.currentUser()?.sub;
  readonly isOwner = computed(() => {
    const board = this.board();
    return board !== null && board.ownerId === this.auth.currentUser()?.sub;
  });
  readonly shareLink = computed(() => {
    const token = this.board()?.inviteToken;
    return token ? `${location.origin}/join/${token}` : null;
  });
  readonly popoverCardId = signal<string | null>(null);
  readonly popoverCard = computed(
    () => this.lists().flatMap((l) => l.cards).find((c) => c.id === this.popoverCardId()) ?? null,
  );
  private readonly memberPop = viewChild.required<ElementRef<HTMLElement>>('memberPop');
  private readonly shareDialog = viewChild.required<ElementRef<HTMLDialogElement>>('shareDialog');
  readonly addingIn = signal<string | null>(null);
  readonly addingList = signal(false);
  readonly renaming = signal<string | null>(null);
  readonly editing = signal<Card | null>(null);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('cardDialog');
  readonly pendingDelete = signal<{ name: string; note?: string; run: () => void } | null>(null);
  private readonly confirmDialog = viewChild.required<ElementRef<HTMLDialogElement>>('confirmDialog');
  private dragging = false;
  /** A remote change that arrived mid-drag, replayed once the drag finishes. */
  private refreshQueued = false;
  private readonly remoteChange = new Subject<void>();

  readonly filterText = signal('');
  readonly filterLabelIds = signal<ReadonlySet<string>>(new Set());
  readonly filterMemberIds = signal<ReadonlySet<string>>(new Set());
  readonly filterActive = computed(
    () => this.filterText().trim().length > 0 || this.filterLabelIds().size > 0 || this.filterMemberIds().size > 0,
  );

  get listIds(): string[] {
    return this.lists().map((l) => l.id);
  }

  constructor() {
    this.api.listLists(this.boardId).subscribe((lists) => {
      this.lists.set(lists);
      this.openCardFromQuery();
    });
    this.boardsApi.get(this.boardId).subscribe({
      next: (board) => this.board.set(board),
      error: () => void this.router.navigate(['/dashboard']),
    });

    // Navigating from a notification to a card on the board we are already viewing
    // only changes the query string, so the component is never reconstructed.
    this.route.queryParamMap
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.openCardFromQuery());

    this.realtime.events
      .pipe(
        // Our own actions are already applied optimistically; replaying them would
        // undo whatever the user typed in the meantime.
        filter((message) => message.boardId === this.boardId && message.actorId !== this.currentUserId),
        takeUntilDestroyed(),
      )
      .subscribe((message) => {
        this.remoteChange.next();
        // Refresh the open card's own panes too, so a comment from someone else
        // shows up without closing and reopening the modal.
        const open = this.editing();
        if (open && message.cardId === open.id) this.loadCardPanes(open.id);
      });

    this.remoteChange
      .pipe(debounceTime(300), takeUntilDestroyed())
      .subscribe(() => this.refreshBoard());
  }

  /**
   * Remote changes re-fetch the whole board rather than patching the local arrays
   * from the event payload. One query, no reconciliation logic to get wrong against
   * the optimistic updates already in flight.
   *
   * ponytail: full board refetch per remote change; if a busy board makes this chatty,
   * narrow it to the affected list before reaching for a CRDT.
   */
  private refreshBoard(): void {
    if (this.dragging) {
      this.refreshQueued = true;
      return;
    }
    this.api.listLists(this.boardId).subscribe((lists) => {
      this.lists.set(lists);
      // The modal holds a reference into the array we just replaced; re-point it at
      // the fresh object, or close it if the card is gone.
      const open = this.editing();
      if (open) {
        const fresh = lists.flatMap((l) => l.cards).find((c) => c.id === open.id);
        if (fresh) this.editing.set(fresh);
        else this.dialog().nativeElement.close();
      }
    });
    this.boardsApi.get(this.boardId).subscribe({ next: (board) => this.board.set(board) });
  }

  private openCardFromQuery(): void {
    const cardId = this.route.snapshot.queryParamMap.get('card');
    if (!cardId || this.editing()?.id === cardId) return;
    const card = this.lists().flatMap((l) => l.cards).find((c) => c.id === cardId);
    if (card) this.openCard(card);
  }

  private loadCardPanes(cardId: string): void {
    this.api.listComments(cardId).subscribe((comments) => this.comments.set(comments));
    this.api.listTimeEntries(cardId).subscribe((entries) => this.timeEntries.set(entries));
    this.api.listAttachments(cardId).subscribe((attachments) => this.attachments.set(attachments));
    this.api.listChecklist(cardId).subscribe((items) => this.checklist.set(items));
    this.api.listActivity(cardId).subscribe((entries) => this.activity.set(entries));
  }

  addList(input: HTMLInputElement): void {
    const title = input.value.trim();
    if (!title) return;
    this.api.createList(this.boardId, title).subscribe((list) => {
      this.lists.update((lists) => [...lists, { ...list, cards: [] }]);
      input.value = '';
    });
  }

  removeList(id: string): void {
    this.api.removeList(id).subscribe(() => {
      this.lists.update((lists) => lists.filter((l) => l.id !== id));
    });
  }

  addCard(list: List, input: HTMLInputElement): void {
    const title = input.value.trim();
    if (!title) return;
    this.api.createCard(list.id, title).subscribe((card) => {
      this.lists.update((lists) =>
        lists.map((l) => (l.id === list.id ? { ...l, cards: [...l.cards, card] } : l)),
      );
      input.value = '';
    });
  }

  removeCard(cardId: string): void {
    this.api.removeCard(cardId).subscribe(() => {
      this.lists.update((lists) => lists.map((l) => ({ ...l, cards: l.cards.filter((c) => c.id !== cardId) })));
    });
  }

  dropList(event: CdkDragDrop<List[]>): void {
    const lists = [...this.lists()];
    moveItemInArray(lists, event.previousIndex, event.currentIndex);
    this.lists.set(lists);

    const siblings = lists.filter((_, i) => i !== event.currentIndex);
    const position = positionAt(siblings, event.currentIndex);
    this.api.moveList(lists[event.currentIndex].id, position).subscribe();
  }

  dropCard(event: CdkDragDrop<Card[]>, targetList: List): void {
    const sourceCards = event.previousContainer.data;
    const targetCards = event.container.data;

    if (event.previousContainer === event.container) {
      moveItemInArray(targetCards, event.previousIndex, event.currentIndex);
    } else {
      transferArrayItem(sourceCards, targetCards, event.previousIndex, event.currentIndex);
    }
    this.lists.update((lists) => [...lists]);

    const siblings = targetCards.filter((_, i) => i !== event.currentIndex);
    const position = positionAt(siblings, event.currentIndex);
    const card = targetCards[event.currentIndex];
    card.listId = targetList.id;
    this.api.moveCard(card.id, targetList.id, position).subscribe();
  }

  rename(list: List, input: HTMLInputElement): void {
    const title = input.value.trim();
    this.renaming.set(null);
    if (!title || title === list.title) return;
    this.api.renameList(list.id, title).subscribe(() => {
      this.lists.update((lists) => lists.map((l) => (l.id === list.id ? { ...l, title } : l)));
    });
  }

  // A drag ends with a click on the card; ignore it so dropping doesn't open the modal.
  onDragStart(): void {
    this.dragging = true;
  }

  onDragEnd(): void {
    setTimeout(() => {
      this.dragging = false;
      if (this.refreshQueued) {
        this.refreshQueued = false;
        this.refreshBoard();
      }
    });
  }

  openCard(card: Card): void {
    if (this.dragging) return;
    this.editing.set(card);
    this.comments.set([]);
    this.timeEntries.set([]);
    this.attachments.set([]);
    this.checklist.set([]);
    this.activity.set([]);
    this.loadCardPanes(card.id);
    this.dialog().nativeElement.showModal();
  }

  /** Clears ?card= so closing the modal doesn't leave a URL that reopens it on reload. */
  onCardDialogClose(): void {
    this.editing.set(null);
    if (this.route.snapshot.queryParamMap.has('card')) {
      void this.router.navigate([], { relativeTo: this.route, queryParams: {} });
    }
  }

  toggleDueDone(card: Card): void {
    const dueDone = !card.dueDone;
    this.api.updateCard(card.id, { dueDone }).subscribe(() => {
      this.lists.update((lists) =>
        lists.map((l) => ({ ...l, cards: l.cards.map((c) => (c.id === card.id ? { ...c, dueDone } : c)) })),
      );
      const open = this.editing();
      if (open?.id === card.id) this.editing.set({ ...open, dueDone });
    });
  }

  saveCard(title: string, description: string, dueDate: string): void {
    const card = this.editing();
    title = title.trim();
    if (!card || !title) return;
    const patch = { title, description: description.trim() || null, dueDate: dueDate || null };
    this.api.updateCard(card.id, patch).subscribe(() => {
      this.lists.update((lists) =>
        lists.map((l) => ({ ...l, cards: l.cards.map((c) => (c.id === card.id ? { ...c, ...patch } : c)) })),
      );
      this.dialog().nativeElement.close();
    });
  }

  askDelete(name: string, run: () => void, note?: string): void {
    this.pendingDelete.set({ name, note, run });
    this.confirmDialog().nativeElement.showModal();
  }

  askDeleteCard(card: Card): void {
    this.askDelete(card.title, () => this.removeCard(card.id));
  }

  confirmDelete(): void {
    this.pendingDelete()?.run();
    this.confirmDialog().nativeElement.close();
    this.dialog().nativeElement.close();
  }

  emailOf(userId: string): string {
    return this.members().find((m) => m.userId === userId)?.email ?? '?';
  }

  initial(email: string): string {
    return email.charAt(0).toUpperCase();
  }

  isAssigned(card: Card, userId: string): boolean {
    return card.assignees.some((a) => a.userId === userId);
  }

  openMembers(card: Card, button: HTMLElement): void {
    if (this.dragging) return;
    const pop = this.memberPop().nativeElement;
    if (pop.matches(':popover-open')) pop.hidePopover();
    this.popoverCardId.set(card.id);
    const rect = button.getBoundingClientRect();
    pop.style.top = `${rect.bottom + 4}px`;
    pop.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 272))}px`;
    pop.showPopover();
  }

  toggleAssignee(card: Card, member: Member): void {
    const assigned = this.isAssigned(card, member.userId);
    const request = assigned
      ? this.api.unassign(card.id, member.userId)
      : this.api.assign(card.id, member.userId);
    request.subscribe(() => {
      const assignees = assigned
        ? card.assignees.filter((a) => a.userId !== member.userId)
        : [...card.assignees, { userId: member.userId }];
      this.lists.update((lists) =>
        lists.map((l) => ({ ...l, cards: l.cards.map((c) => (c.id === card.id ? { ...c, assignees } : c)) })),
      );
    });
  }

  isLabelOn(card: Card, label: Label): boolean {
    return card.labels.some((l) => l.labelId === label.id);
  }

  toggleLabel(card: Card, label: Label): void {
    const on = this.isLabelOn(card, label);
    const request = on ? this.api.removeLabel(card.id, label.id) : this.api.addLabel(card.id, label.id);
    request.subscribe(() => {
      const labels = on
        ? card.labels.filter((l) => l.labelId !== label.id)
        : [...card.labels, { labelId: label.id }];
      this.lists.update((lists) =>
        lists.map((l) => ({ ...l, cards: l.cards.map((c) => (c.id === card.id ? { ...c, labels } : c)) })),
      );
    });
  }

  addBoardLabel(color: string, input: HTMLInputElement): void {
    const name = input.value.trim();
    this.boardsApi.createLabel(this.boardId, name, color).subscribe((label) => {
      this.board.update((b) => (b ? { ...b, labels: [...b.labels, label] } : b));
      input.value = '';
      const card = this.editing();
      if (card) this.toggleLabel(card, label);
    });
  }

  removeBoardLabel(label: Label): void {
    this.boardsApi.removeLabel(this.boardId, label.id).subscribe(() => {
      this.board.update((b) => (b ? { ...b, labels: b.labels.filter((l) => l.id !== label.id) } : b));
      this.lists.update((lists) =>
        lists.map((l) => ({
          ...l,
          cards: l.cards.map((c) => ({ ...c, labels: c.labels.filter((cl) => cl.labelId !== label.id) })),
        })),
      );
    });
  }

  addComment(card: Card, input: HTMLTextAreaElement): void {
    const body = input.value.trim();
    if (!body) return;
    this.api.addComment(card.id, body).subscribe((comment) => {
      this.comments.update((comments) => [...comments, comment]);
      input.value = '';
      this.lists.update((lists) =>
        lists.map((l) => ({
          ...l,
          cards: l.cards.map((c) =>
            c.id === card.id ? { ...c, _count: { ...c._count, comments: c._count.comments + 1 } } : c,
          ),
        })),
      );
    });
  }

  removeComment(card: Card, comment: Comment): void {
    this.api.removeComment(card.id, comment.id).subscribe(() => {
      this.comments.update((comments) => comments.filter((c) => c.id !== comment.id));
      this.lists.update((lists) =>
        lists.map((l) => ({
          ...l,
          cards: l.cards.map((c) =>
            c.id === card.id ? { ...c, _count: { ...c._count, comments: c._count.comments - 1 } } : c,
          ),
        })),
      );
    });
  }

  totalHours(card: Card): number {
    return card.timeEntries.reduce((sum, e) => sum + e.hours, 0);
  }

  addTimeEntry(card: Card, dateInput: HTMLInputElement, hoursInput: HTMLInputElement, noteInput: HTMLInputElement): void {
    const date = dateInput.value;
    const hours = Number(hoursInput.value);
    if (!date || !hours) return;
    this.api.addTimeEntry(card.id, date, hours, noteInput.value.trim() || undefined).subscribe((entry) => {
      this.timeEntries.update((entries) => [entry, ...entries]);
      dateInput.value = '';
      hoursInput.value = '';
      noteInput.value = '';
      this.lists.update((lists) =>
        lists.map((l) => ({
          ...l,
          cards: l.cards.map((c) =>
            c.id === card.id ? { ...c, timeEntries: [...c.timeEntries, { hours: entry.hours }] } : c,
          ),
        })),
      );
    });
  }

  removeTimeEntry(card: Card, entry: TimeEntry): void {
    this.api.removeTimeEntry(card.id, entry.id).subscribe(() => {
      this.timeEntries.update((entries) => entries.filter((e) => e.id !== entry.id));
      // The card face only keeps bare hours (no id) for the total; drop one matching value.
      this.lists.update((lists) =>
        lists.map((l) => ({
          ...l,
          cards: l.cards.map((c) => {
            if (c.id !== card.id) return c;
            const rest = [...c.timeEntries];
            const i = rest.findIndex((h) => h.hours === entry.hours);
            if (i !== -1) rest.splice(i, 1);
            return { ...c, timeEntries: rest };
          }),
        })),
      );
    });
  }

  formatEntryDate(date: string): string {
    return new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  uploadAttachment(card: Card, input: HTMLInputElement): void {
    const file = input.files?.[0];
    if (!file) return;
    this.api.addAttachment(card.id, file).subscribe({
      next: (attachment) => {
        this.attachments.update((atts) => [attachment, ...atts]);
        this.lists.update((lists) =>
          lists.map((l) => ({
            ...l,
            cards: l.cards.map((c) =>
              c.id === card.id ? { ...c, _count: { ...c._count, attachments: c._count.attachments + 1 } } : c,
            ),
          })),
        );
        input.value = '';
      },
      error: () => (input.value = ''),
    });
  }

  removeAttachment(card: Card, attachment: Attachment): void {
    this.api.removeAttachment(card.id, attachment.id).subscribe(() => {
      this.attachments.update((atts) => atts.filter((a) => a.id !== attachment.id));
      this.lists.update((lists) =>
        lists.map((l) => ({
          ...l,
          cards: l.cards.map((c) =>
            c.id === card.id ? { ...c, _count: { ...c._count, attachments: c._count.attachments - 1 } } : c,
          ),
        })),
      );
    });
  }

  attachmentUrl(attachment: Attachment): string {
    return `/uploads/${attachment.path}`;
  }

  setFilterText(value: string): void {
    this.filterText.set(value);
  }

  toggleFilterLabel(labelId: string): void {
    this.filterLabelIds.update((ids) => toggled(ids, labelId));
  }

  toggleFilterMember(userId: string): void {
    this.filterMemberIds.update((ids) => toggled(ids, userId));
  }

  clearFilters(): void {
    this.filterText.set('');
    this.filterLabelIds.set(new Set());
    this.filterMemberIds.set(new Set());
  }

  // Hidden via CSS, not removed from the array, so cdkDrag/cdkDropList indices stay valid while a filter is active.
  cardMatchesFilter(card: Card): boolean {
    const text = this.filterText().trim().toLowerCase();
    if (text && !card.title.toLowerCase().includes(text)) return false;
    const labelIds = this.filterLabelIds();
    if (labelIds.size > 0 && !card.labels.some((l) => labelIds.has(l.labelId))) return false;
    const memberIds = this.filterMemberIds();
    if (memberIds.size > 0 && !card.assignees.some((a) => memberIds.has(a.userId))) return false;
    return true;
  }

  checklistDone(card: Card): number {
    return card.checklist.filter((i) => i.done).length;
  }

  addChecklistItem(card: Card, input: HTMLInputElement): void {
    const text = input.value.trim();
    if (!text) return;
    this.api.addChecklistItem(card.id, text).subscribe((item) => {
      this.checklist.update((items) => [...items, item]);
      input.value = '';
      this.lists.update((lists) =>
        lists.map((l) => ({
          ...l,
          cards: l.cards.map((c) =>
            c.id === card.id ? { ...c, checklist: [...c.checklist, { done: item.done }] } : c,
          ),
        })),
      );
    });
  }

  toggleChecklistItem(card: Card, item: ChecklistItem): void {
    const done = !item.done;
    this.api.updateChecklistItem(card.id, item.id, { done }).subscribe(() => {
      this.checklist.update((items) => items.map((i) => (i.id === item.id ? { ...i, done } : i)));
      this.lists.update((lists) =>
        lists.map((l) => ({
          ...l,
          cards: l.cards.map((c) => {
            if (c.id !== card.id) return c;
            const i = c.checklist.findIndex((x) => x.done === item.done);
            const checklist = [...c.checklist];
            if (i !== -1) checklist[i] = { done };
            return { ...c, checklist };
          }),
        })),
      );
    });
  }

  removeChecklistItem(card: Card, item: ChecklistItem): void {
    this.api.removeChecklistItem(card.id, item.id).subscribe(() => {
      this.checklist.update((items) => items.filter((i) => i.id !== item.id));
      this.lists.update((lists) =>
        lists.map((l) => ({
          ...l,
          cards: l.cards.map((c) => {
            if (c.id !== card.id) return c;
            const checklist = [...c.checklist];
            const i = checklist.findIndex((x) => x.done === item.done);
            if (i !== -1) checklist.splice(i, 1);
            return { ...c, checklist };
          }),
        })),
      );
    });
  }

  // A completed due date is never overdue, however far in the past it is.
  isOverdue(card: Card): boolean {
    return !card.dueDone && card.dueDate !== null && new Date(card.dueDate).getTime() < Date.now();
  }

  // <input type="date"> wants yyyy-mm-dd; the API gives back a full ISO timestamp.
  dateInputValue(dueDate: string | null): string {
    return dueDate ? dueDate.slice(0, 10) : '';
  }

  formatDueDate(dueDate: string): string {
    return new Date(dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  openShare(): void {
    this.shareDialog().nativeElement.showModal();
  }

  createInvite(): void {
    this.boardsApi.createInvite(this.boardId).subscribe(({ token }) => {
      this.board.update((b) => (b ? { ...b, inviteToken: token } : b));
    });
  }

  stopSharing(): void {
    this.boardsApi.revokeInvite(this.boardId).subscribe(() => {
      this.board.update((b) => (b ? { ...b, inviteToken: null } : b));
    });
  }

  async copyLink(input: HTMLInputElement): Promise<void> {
    input.select();
    try {
      await navigator.clipboard.writeText(input.value);
    } catch {
      // Clipboard needs a secure context; the link stays selected so Ctrl+C still works.
    }
  }
}

function toggled<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  next.has(value) ? next.delete(value) : next.add(value);
  return next;
}
