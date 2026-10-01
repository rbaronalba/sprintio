import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
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
import { AppHeaderComponent } from '../header/app-header.component';
import { avatarStyle, initials } from '../shared/avatar';
import { backgroundStyle } from '../shared/background';
import { AuthService } from '../auth/auth.service';
import { CLIENT_ID, RealtimeService } from '../realtime/realtime.service';
import { actorName, describeEvent, relativeTime } from '../realtime/activity';
import { ActivityEntry, ArchivedCard, Board, BoardDetail, BoardsService, Label, Member } from '../services/boards.service';
import { Attachment, BoardService, COMMENT_PAGE, Card, ChecklistItem, Comment, List, Moved, TimeEntry } from '../services/board.service';
import { RichEditorComponent, RichPipe } from '../shared/rich-text';

// Mirrors the fixed palette the API accepts (apps/api/src/boards/dto.ts): 5 columns x 6 rows.
export const LABEL_COLORS = [
  '#baf3db', '#f8e6a0', '#fedec8', '#ffd5d2', '#dfd8fd',
  '#4bce97', '#f5cd47', '#fea362', '#f87168', '#9f8fef',
  '#1f845a', '#946f00', '#c25100', '#c9372c', '#6e5dc6',
  '#cce0ff', '#c6edfb', '#d3f1a7', '#fdd0ec', '#dcdfe4',
  '#579dff', '#6cc3e0', '#94c748', '#e774bb', '#8590a2',
  '#0c66e4', '#227d9b', '#5b7f24', '#ae4787', '#626f86',
];

@Component({
  selector: 'app-board-detail',
  imports: [
    AppHeaderComponent,
    CdkDropList,
    CdkDrag,
    CdkDragHandle,
    NgTemplateOutlet,
    RichEditorComponent,
    RichPipe,
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
  /** For card faces: each card walks its own few labels instead of every label on the board. */
  readonly labelById = computed(() => new Map(this.labels().map((l) => [l.id, l])));
  // Header avatars: four faces, then one "+N" button that opens the full member list.
  readonly shownMembers = computed(() => this.members().slice(0, 4));
  readonly hiddenMembers = computed(() => Math.max(0, this.members().length - 4));
  readonly boardsOpen = signal(false);
  readonly filterOpen = signal(false);
  readonly bgOpen = signal(false);
  readonly renamingBoard = signal(false);
  readonly bgStyle = backgroundStyle;
  /** Whose background the hidden file input is choosing an image for; null = the board. */
  private bgUploadFor: List | null = null;
  readonly allBoards = signal<Board[]>([]);
  readonly labelColors = LABEL_COLORS;
  /** '' means "no color", which the API accepts. */
  readonly pickedColor = signal<string>('#6cc3e0');
  readonly newLabelName = signal('');
  /** The label popover has two screens, like Trello's: pick labels, or create one. */
  readonly labelView = signal<'list' | 'create'>('list');
  // "Add time" popover fields.
  readonly timeMemberId = signal('');
  readonly timeHours = signal('');
  readonly timeDate = signal('');
  readonly timeNote = signal('');
  /** Set when the popover edits an existing entry instead of adding time. */
  readonly editingEntry = signal<TimeEntry | null>(null);
  readonly comments = signal<Comment[]>([]);
  /** The last page came back full, so there may be older comments to fetch. */
  readonly moreComments = signal(false);
  readonly timeEntries = signal<TimeEntry[]>([]);
  /** Card-level images from before comments carried their own; read-only now. */
  readonly attachments = signal<Attachment[]>([]);
  /** Image picked for the comment being written; sent with it on "Comment". */
  readonly pendingFile = signal<File | null>(null);
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
  private readonly memberPopModal = viewChild.required<ElementRef<HTMLElement>>('memberPopModal');
  private readonly labelPop = viewChild.required<ElementRef<HTMLElement>>('labelPop');
  private readonly shareDialog = viewChild.required<ElementRef<HTMLDialogElement>>('shareDialog');
  readonly addingIn = signal<string | null>(null);
  readonly addingList = signal(false);
  readonly renaming = signal<string | null>(null);
  readonly editing = signal<Card | null>(null);
  readonly editingTitle = signal(false);
  readonly archived = signal<ArchivedCard[]>([]);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('cardDialog');
  private readonly descField = viewChild('descField', { read: RichEditorComponent });
  /** `verb` replaces "delete" for actions that can be undone (removing a member, leaving). */
  readonly pendingDelete = signal<{ name: string; note?: string; verb?: string; label?: string; run: () => void } | null>(null);
  private readonly confirmDialog = viewChild.required<ElementRef<HTMLDialogElement>>('confirmDialog');
  private dragging = false;
  /** A remote change that arrived mid-drag, replayed once the drag finishes. */
  private refreshQueued = false;
  private readonly remoteChange = new Subject<void>();
  /** Cards touched by remote events, re-fetched one by one after a short debounce. */
  private readonly staleCardIds = new Set<string>();
  private readonly remoteCardChange = new Subject<void>();

  readonly filterLabelIds = signal<ReadonlySet<string>>(new Set());
  readonly filterMemberIds = signal<ReadonlySet<string>>(new Set());
  readonly filterActive = computed(
    () => this.filterLabelIds().size > 0 || this.filterMemberIds().size > 0,
  );

  toggleBoards(): void {
    this.filterOpen.set(false);
    this.boardsOpen.update((open) => !open);
    if (this.boardsOpen()) this.boardsApi.list().subscribe((b) => this.allBoards.set(b));
  }

  /** Owner only. Saves on Enter/blur; an empty or unchanged title just closes the input. */
  renameBoard(value: string): void {
    if (!this.renamingBoard()) return; // blur after Escape
    this.renamingBoard.set(false);
    const title = value.trim();
    const board = this.board();
    if (!board || !title || title === board.title) return;
    this.board.set({ ...board, title });
    this.boardsApi.rename(board.id, title).subscribe({
      error: () => this.board.update((b) => (b ? { ...b, title: board.title } : b)),
    });
  }

  /** `list` null = the board itself. */
  setBackground(list: List | null, value: string | File): void {
    const apply = (background: string) =>
      list
        ? this.lists.update((ls) => ls.map((l) => (l.id === list.id ? { ...l, background } : l)))
        : this.board.update((b) => (b ? { ...b, background } : b));
    const req = list ? this.api.setListBackground(list.id, value) : this.boardsApi.setBackground(this.boardId, value);
    req.subscribe(({ background }) => apply(background));
  }

  pickBackgroundImage(list: List | null, input: HTMLInputElement): void {
    this.bgUploadFor = list;
    input.click();
  }

  uploadBackground(input: HTMLInputElement): void {
    const file = input.files?.[0];
    input.value = '';
    if (file) this.setBackground(this.bgUploadFor, file);
  }

  toggleStar(): void {
    const board = this.board();
    if (!board) return;
    const starred = !board.starred;
    this.board.set({ ...board, starred });
    this.boardsApi.setStarred(board.id, starred).subscribe({
      error: () => this.board.update((b) => (b ? { ...b, starred: !starred } : b)),
    });
  }

  /** A click anywhere outside the bar's dropdowns closes them. */
  @HostListener('document:mousedown', ['$event'])
  closeDropdowns(event: MouseEvent): void {
    if ((event.target as Element).closest('.dd')) return;
    this.boardsOpen.set(false);
    this.filterOpen.set(false);
  }

  switchBoard(id: string): void {
    this.boardsOpen.set(false);
    if (id !== this.boardId) void this.router.navigate(['/boards', id]);
  }

  get listIds(): string[] {
    return this.lists().map((l) => l.id);
  }

  constructor() {
    // Board ids are cuids. Anything else (say ..%2F..%2Fauth) would be interpolated into
    // API paths and could steer requests elsewhere on this origin.
    if (!/^[a-z0-9]+$/.test(this.boardId)) {
      void this.router.navigate(['/home']);
      return;
    }
    this.api.listLists(this.boardId).subscribe((lists) => {
      this.lists.set(lists);
      this.openCardFromQuery();
    });
    this.boardsApi.get(this.boardId).subscribe({
      next: (board) => this.board.set(board),
      // Missing or not a member: same 404 as a bad URL, keeping the URL the user typed.
      error: () => void this.router.navigate(['/404'], { skipLocationChange: true }),
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
        filter((message) => message.boardId === this.boardId && message.clientId !== CLIENT_ID),
        takeUntilDestroyed(),
      )
      .subscribe((message) => {
        if (message.type === 'MEMBER_REMOVED' && message.data['userId'] === this.currentUserId) {
          void this.router.navigate(['/home']);
          return;
        }
        if (message.type.startsWith('MEMBER_') || ['BACKGROUND_CHANGED', 'BOARD_RENAMED', 'OWNER_CHANGED'].includes(message.type)) {
          this.boardsApi.get(this.boardId).subscribe((board) => this.board.set(board));
        }
        // Card-level events (the vast majority) re-fetch just that card. List and board
        // level ones are rare and change the shape of the board, so those reload it all.
        if (message.type === 'CARD_DELETED' && message.cardId) {
          this.removeCardLocally(message.cardId);
        } else if (message.cardId) {
          this.staleCardIds.add(message.cardId);
          this.remoteCardChange.next();
        } else {
          this.remoteChange.next();
        }
        // Refresh the open card's own panes too, so a comment from someone else
        // shows up without closing and reopening the modal.
        const open = this.editing();
        if (open && message.cardId === open.id) this.loadCardPanes(open.id);
      });

    this.remoteChange
      .pipe(debounceTime(300), takeUntilDestroyed())
      .subscribe(() => this.refreshBoard());
    this.remoteCardChange
      .pipe(debounceTime(300), takeUntilDestroyed())
      .subscribe(() => this.refreshStaleCards());

    // Events sent while the stream was down are gone for good: resync once it is back.
    let dropped = false;
    effect(() => {
      const connected = this.realtime.connected();
      if (!connected) dropped = untracked(this.lists).length > 0;
      else if (dropped) {
        dropped = false;
        untracked(() => this.refreshBoard());
      }
    });
  }

  /** Re-fetches each card a remote event touched and slots it where the server says it is. */
  private refreshStaleCards(): void {
    // Mid-drag the ids just wait in the set; onDragEnd flushes them.
    if (this.dragging) return;
    const ids = [...this.staleCardIds];
    this.staleCardIds.clear();
    for (const id of ids) {
      this.api.getCard(id).subscribe({
        next: (card) => this.applyRemoteCard(card),
        // Gone (deleted, or we lost access): drop it.
        error: () => this.removeCardLocally(id),
      });
    }
  }

  private applyRemoteCard(fresh: Card): void {
    if (fresh.archived) return this.removeCardLocally(fresh.id);
    // A list we have never seen (created remotely a moment ago): cheaper to reload than to guess.
    if (!this.lists().some((l) => l.id === fresh.listId)) return this.refreshBoard();
    const { description: _, ...face } = fresh;
    this.lists.update((lists) =>
      lists.map((l) => {
        const cards = l.cards.filter((c) => c.id !== fresh.id);
        if (l.id !== fresh.listId) return cards.length === l.cards.length ? l : { ...l, cards };
        cards.push(face);
        return { ...l, cards: cards.sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : 1)) };
      }),
    );
    const open = this.editing();
    // Keep the description the modal already has; the face never carries it.
    if (open?.id === fresh.id) this.editing.set({ ...face, description: open.description });
  }

  private removeCardLocally(id: string): void {
    this.lists.update((lists) => lists.map((l) => ({ ...l, cards: l.cards.filter((c) => c.id !== id) })));
    if (this.editing()?.id === id) this.dialog().nativeElement.close();
  }

  /**
   * Remote changes re-fetch the whole board rather than patching the local arrays
   * from the event payload. One query, no reconciliation logic to get wrong against
   * the optimistic updates already in flight.
   *
   * Only for list/board level events, a reconnect or a failed move: card events go
   * through refreshStaleCards.
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
        if (fresh) this.editing.set({ ...fresh, description: open.description });
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
    this.api.listComments(cardId).subscribe((comments) => {
      this.comments.set(comments);
      this.moreComments.set(comments.length === COMMENT_PAGE);
    });
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

    const list = lists[event.currentIndex];
    this.api.moveList(list.id, lists[event.currentIndex - 1]?.id ?? null).subscribe(this.afterMove(list));
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

    const card = targetCards[event.currentIndex];
    card.listId = targetList.id;
    const afterId = targetCards[event.currentIndex - 1]?.id ?? null;
    this.api.moveCard(card.id, targetList.id, afterId).subscribe(this.afterMove(card));
  }

  /**
   * The server decides the position; adopt it so later local sorting agrees. If the gaps
   * ran out it renumbered every sibling, and a rejected move (list full, deleted meanwhile)
   * leaves this view wrong: both resync from the server.
   */
  private afterMove(item: { position: number }) {
    return {
      next: (moved: Moved) => {
        item.position = moved.position;
        if (moved.renumbered) this.refreshBoard();
      },
      error: () => this.refreshBoard(),
    };
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
        this.staleCardIds.clear(); // the full reload covers them
        this.refreshBoard();
      } else if (this.staleCardIds.size > 0) {
        this.refreshStaleCards();
      }
    });
  }

  openCard(card: Card): void {
    if (this.dragging) return;
    this.editing.set(card);
    this.editingTitle.set(false);
    this.comments.set([]);
    this.timeEntries.set([]);
    this.attachments.set([]);
    this.checklist.set([]);
    this.activity.set([]);
    this.pendingFile.set(null);
    this.loadCardPanes(card.id);
    this.dialog().nativeElement.showModal();
    // The board payload has no descriptions; fetch this one and drop it into the editor.
    this.api.getCard(card.id).subscribe((full) => {
      if (this.editing()?.id !== card.id) return;
      this.editing.set({ ...this.editing()!, description: full.description });
      const editor = this.descField();
      if (editor) editor.value = full.description ?? '';
    });
  }

  /** Clears ?card= so closing the modal doesn't leave a URL that reopens it on reload. */
  onCardDialogClose(): void {
    this.editing.set(null);
    if (this.route.snapshot.queryParamMap.has('card')) {
      void this.router.navigate([], { relativeTo: this.route, queryParams: {} });
    }
  }

  private patchCardLocally(id: string, patch: Partial<Card>): void {
    this.lists.update((lists) =>
      lists.map((l) => ({ ...l, cards: l.cards.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
    );
    const open = this.editing();
    if (open?.id === id) this.editing.set({ ...open, ...patch });
  }

  saveTitle(card: Card, input: HTMLInputElement): void {
    const title = input.value.trim();
    this.editingTitle.set(false);
    if (!title || title === card.title) return;
    this.api.updateCard(card.id, { title }).subscribe(() => this.patchCardLocally(card.id, { title }));
  }

  moveCurrentCard(card: Card, listId: string): void {
    if (listId === card.listId) return;
    const target = this.lists().find((l) => l.id === listId);
    if (!target) return;
    const last = target.cards.at(-1);
    // Provisional until the server answers with the real one.
    const position = (last?.position ?? 0) + 1000;
    this.lists.update((lists) =>
      lists.map((l) => {
        if (l.id === card.listId) return { ...l, cards: l.cards.filter((c) => c.id !== card.id) };
        if (l.id === listId) return { ...l, cards: [...l.cards, { ...card, listId, position }] };
        return l;
      }),
    );
    this.patchCardLocally(card.id, { listId, position });
    this.api.moveCard(card.id, listId, last?.id ?? null).subscribe({
      next: (moved) => (moved.renumbered ? this.refreshBoard() : this.patchCardLocally(card.id, { position: moved.position })),
      error: () => this.refreshBoard(),
    });
  }

  copyCard(card: Card): void {
    this.api.createCard(card.listId, `${card.title} (copia)`).subscribe((copy) => {
      const patch = { description: this.editing()?.id === card.id ? this.editing()!.description : null };
      this.api.updateCard(copy.id, patch).subscribe();
      this.lists.update((lists) =>
        lists.map((l) => (l.id === card.listId ? { ...l, cards: [...l.cards, { ...copy, ...patch }] } : l)),
      );
    });
  }

  openArchived(dialog: HTMLDialogElement): void {
    this.boardsOpen.set(false);
    this.boardsApi.listArchived(this.boardId).subscribe((cards) => this.archived.set(cards));
    dialog.showModal();
  }

  restoreCard(id: string): void {
    this.api.updateCard(id, { archived: false }).subscribe(() => {
      this.archived.update((cards) => cards.filter((c) => c.id !== id));
      this.api.getCard(id).subscribe((card) => this.applyRemoteCard(card));
    });
  }

  /** The date input's yyyy-mm-dd, in local time. */
  dueInput(iso: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  setDue(card: Card, value: string): void {
    // The end of the chosen day, local time: a card due today is not overdue until tomorrow.
    const dueDate = value ? new Date(`${value}T23:59:59`).toISOString() : null;
    this.api
      .updateCard(card.id, { dueDate })
      .subscribe(() => this.patchCardLocally(card.id, { dueDate, ...(!dueDate && { dueDone: false }) }));
  }

  toggleDueDone(card: Card): void {
    const dueDone = !card.dueDone;
    this.api.updateCard(card.id, { dueDone }).subscribe(() => this.patchCardLocally(card.id, { dueDone }));
  }

  async shareCard(card: Card): Promise<void> {
    const url = `${location.origin}/boards/${this.boardId}?card=${card.id}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Best-effort: no secure context, no clipboard. Nothing else to fall back to here.
    }
  }

  archiveCard(card: Card): void {
    this.api.updateCard(card.id, { archived: true }).subscribe(() => {
      this.lists.update((lists) =>
        lists.map((l) => ({ ...l, cards: l.cards.filter((c) => c.id !== card.id) })),
      );
      this.dialog().nativeElement.close();
    });
  }

  saveCard(description: string): void {
    const card = this.editing();
    if (!card) return;
    const patch = { description: description.trim() || null };
    this.api.updateCard(card.id, patch).subscribe(() => {
      this.patchCardLocally(card.id, patch);
      this.dialog().nativeElement.close();
    });
  }

  askDelete(name: string, run: () => void, note?: string): void {
    this.pendingDelete.set({ name, note, run });
    this.confirmDialog().nativeElement.showModal();
  }

  askRemoveMember(member: Member): void {
    this.pendingDelete.set({
      name: member.email,
      verb: 'quitar a',
      label: 'Quitar',
      note: 'Perderá el acceso a este tablero y se le quitará de sus tarjetas.',
      run: () =>
        this.boardsApi.removeMember(this.boardId, member.userId).subscribe(() => {
          this.board.update((b) => (b ? { ...b, members: b.members.filter((m) => m.userId !== member.userId) } : b));
          this.lists.update((lists) =>
            lists.map((l) => ({
              ...l,
              cards: l.cards.map((c) => ({ ...c, assignees: c.assignees.filter((a) => a.userId !== member.userId) })),
            })),
          );
        }),
    });
    this.confirmDialog().nativeElement.showModal();
  }

  askMakeOwner(member: Member): void {
    this.pendingDelete.set({
      name: member.displayName || member.email,
      verb: 'ceder este tablero a',
      label: 'Hacer administrador',
      note: 'Solo el administrador puede renombrar, compartir o eliminar el tablero. Seguirás en él como miembro.',
      run: () =>
        this.boardsApi
          .transferOwnership(this.boardId, member.userId)
          .subscribe(() => this.board.update((b) => (b ? { ...b, ownerId: member.userId, inviteToken: null } : b))),
    });
    this.confirmDialog().nativeElement.showModal();
  }

  askLeave(): void {
    const me = this.currentUserId;
    if (!me) return;
    this.pendingDelete.set({
      name: this.board()?.title ?? 'este tablero',
      verb: 'salir de',
      label: 'Salir',
      note: 'Necesitarás un nuevo enlace de invitación para volver.',
      run: () => this.boardsApi.removeMember(this.boardId, me).subscribe(() => void this.router.navigate(['/home'])),
    });
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

  memberOf(userId: string): Member | undefined {
    return this.members().find((m) => m.userId === userId);
  }

  /**
   * A stable color per person, derived from their id: the same user gets the same color on
   * every board and every device, with nothing stored. Bold palette colors, so white text reads.
   */
  readonly avatarStyle = avatarStyle;
  readonly initials = initials;

  isAssigned(card: Card, userId: string): boolean {
    return card.assignees.some((a) => a.userId === userId);
  }

  openMembers(card: Card, button: HTMLElement): void {
    if (this.dragging) return;
    // With the card modal open, only a popover inside it can receive clicks.
    const pop = (this.dialog().nativeElement.open ? this.memberPopModal() : this.memberPop()).nativeElement;
    if (pop.matches(':popover-open')) pop.hidePopover();
    this.popoverCardId.set(card.id);
    pop.showPopover();
    this.placePopover(pop, button.getBoundingClientRect());
  }

  private labelAnchor: DOMRect | null = null;

  openLabels(card: Card, button: HTMLElement): void {
    const pop = this.labelPop().nativeElement;
    if (pop.matches(':popover-open')) pop.hidePopover();
    this.labelView.set('list');
    this.popoverCardId.set(card.id);
    this.labelAnchor = button.getBoundingClientRect();
    pop.showPopover();
    this.placePopover(pop, this.labelAnchor);
  }

  /** Below the trigger, but slid up when it would run off the bottom of the screen. */
  private placePopover(pop: HTMLElement, anchor: DOMRect): void {
    pop.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - pop.offsetWidth - 8))}px`;
    pop.style.top = `${anchor.bottom + 4}px`;
    const overflow = pop.getBoundingClientRect().bottom - (window.innerHeight - 8);
    if (overflow > 0) pop.style.top = `${Math.max(8, anchor.bottom + 4 - overflow)}px`;
  }

  setLabelView(view: 'list' | 'create'): void {
    this.labelView.set(view);
    // The two screens differ in height: re-place once the new one has rendered.
    setTimeout(() => this.labelAnchor && this.placePopover(this.labelPop().nativeElement, this.labelAnchor));
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
      this.patchCardLocally(card.id, { assignees });
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
      this.patchCardLocally(card.id, { labels });
    });
  }

  startCreateLabel(): void {
    this.newLabelName.set('');
    this.pickedColor.set('#6cc3e0');
    this.setLabelView('create');
  }

  createLabel(): void {
    const name = this.newLabelName().trim();
    const color = this.pickedColor();
    if (!name && !color) return;
    this.boardsApi.createLabel(this.boardId, name, color).subscribe((label) => {
      this.board.update((b) => (b ? { ...b, labels: [...b.labels, label] } : b));
      this.setLabelView('list');
      const card = this.editing();
      if (card) this.toggleLabel(card, label);
    });
  }

  /** Background + readable text for a label; colorless labels get an outline instead. */
  chipStyle(color: string): Record<string, string> {
    if (!color) return { background: 'transparent', color: 'var(--ink)', 'box-shadow': 'inset 0 0 0 1px var(--hairline)' };
    const n = parseInt(color.slice(1), 16);
    const luma = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
    return { background: color, color: luma > 150 ? '#172b4d' : '#ffffff' };
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
      this.editing.update((c) =>
        c ? { ...c, labels: c.labels.filter((cl) => cl.labelId !== label.id) } : c,
      );
    });
  }

  pickCommentFile(input: HTMLInputElement): void {
    this.pendingFile.set(input.files?.[0] ?? null);
    input.value = '';
  }

  addComment(card: Card, input: { value: string }): void {
    const body = input.value.trim();
    const file = this.pendingFile();
    if (!body && !file) return;
    this.api.addComment(card.id, body, file).subscribe((comment) => {
      this.comments.update((comments) => [...comments, comment]);
      input.value = '';
      this.pendingFile.set(null);
      this.bumpCounts(card.id, 1, comment.attachments.length);
    });
  }

  loadOlderComments(card: Card): void {
    const oldest = this.comments()[0];
    if (!oldest) return;
    this.api.listComments(card.id, oldest.id).subscribe((older) => {
      this.comments.update((comments) => [...older, ...comments]);
      this.moreComments.set(older.length === COMMENT_PAGE);
    });
  }

  private bumpCounts(cardId: string, comments: number, attachments: number): void {
    this.lists.update((lists) =>
      lists.map((l) => ({
        ...l,
        cards: l.cards.map((c) =>
          c.id === cardId
            ? { ...c, _count: { ...c._count, comments: c._count.comments + comments, attachments: c._count.attachments + attachments } }
            : c,
        ),
      })),
    );
  }

  removeComment(card: Card, comment: Comment): void {
    this.api.removeComment(card.id, comment.id).subscribe(() => {
      this.comments.update((comments) => comments.filter((c) => c.id !== comment.id));
      this.bumpCounts(card.id, -1, -comment.attachments.length);
    });
  }

  openTime(button: HTMLElement, pop: HTMLElement, entry?: TimeEntry): void {
    this.editingEntry.set(entry ?? null);
    this.timeMemberId.set(entry?.userId ?? this.currentUserId ?? '');
    this.timeHours.set(entry ? String(entry.hours) : '');
    this.timeDate.set(entry ? entry.date.slice(0, 10) : new Date().toISOString().slice(0, 10));
    this.timeNote.set(entry?.note ?? '');
    pop.showPopover();
    this.placePopover(pop, button.getBoundingClientRect());
  }

  /** Hours as typed, or null when it isn't something the API would accept (0 < h <= 24). */
  timeHoursValue(): number | null {
    const hours = Number(this.timeHours().replace(',', '.'));
    return Number.isFinite(hours) && hours > 0 && hours <= 24 ? hours : null;
  }

  saveTimeEntry(card: Card, pop: HTMLElement): void {
    const hours = this.timeHoursValue();
    const date = this.timeDate();
    if (hours === null || !date) return;
    const note = this.timeNote().trim() || null;
    const editing = this.editingEntry();
    const request = editing
      ? this.api.updateTimeEntry(card.id, editing.id, hours, note)
      : this.api.addTimeEntry(card.id, date, hours, note ?? undefined, this.timeMemberId() || undefined);
    request.subscribe((entry) => {
      // Adding time to a day that already has some returns that same (merged) entry.
      this.timeEntries.update((entries) => [entry, ...entries.filter((e) => e.id !== entry.id)].sort((a, b) => b.date.localeCompare(a.date)));
      pop.hidePopover();
      this.syncCardHours(card.id);
    });
  }

  removeTimeEntry(card: Card, entry: TimeEntry): void {
    this.api.removeTimeEntry(card.id, entry.id).subscribe(() => {
      this.timeEntries.update((entries) => entries.filter((e) => e.id !== entry.id));
      this.syncCardHours(card.id);
    });
  }

  /** The card face only keeps the total; recompute it from the modal's full list.
   *  Via patchCardLocally so the modal's total updates too, not just the card face. */
  private syncCardHours(cardId: string): void {
    this.patchCardLocally(cardId, { hoursTotal: this.timeEntries().reduce((sum, e) => sum + e.hours, 0) });
  }

  formatEntryDate(date: string): string {
    return new Date(date).toLocaleDateString('es', { month: 'short', day: 'numeric', year: 'numeric' });
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

  /** Mirrors the API: only these are served inline, everything else downloads. */
  isImage(attachment: { path: string }): boolean {
    return /\.(png|jpe?g|gif|webp)$/.test(attachment.path);
  }

  attachmentUrl(attachment: { path: string }): string {
    return `/uploads/${attachment.path}`;
  }

  toggleFilterLabel(labelId: string): void {
    this.filterLabelIds.update((ids) => toggled(ids, labelId));
  }

  toggleFilterMember(userId: string): void {
    this.filterMemberIds.update((ids) => toggled(ids, userId));
  }

  clearFilters(): void {
    this.filterLabelIds.set(new Set());
    this.filterMemberIds.set(new Set());
  }

  // Hidden via CSS, not removed from the array, so cdkDrag/cdkDropList indices stay valid while a filter is active.
  cardMatchesFilter(card: Card): boolean {
    const labelIds = this.filterLabelIds();
    if (labelIds.size > 0 && !card.labels.some((l) => labelIds.has(l.labelId))) return false;
    const memberIds = this.filterMemberIds();
    if (memberIds.size > 0 && !card.assignees.some((a) => memberIds.has(a.userId))) return false;
    return true;
  }

  addChecklistItem(card: Card, input: HTMLInputElement): void {
    const text = input.value.trim();
    if (!text) return;
    this.api.addChecklistItem(card.id, text).subscribe((item) => {
      this.checklist.update((items) => [...items, item]);
      input.value = '';
      this.syncCardChecklist(card.id);
    });
  }

  toggleChecklistItem(card: Card, item: ChecklistItem): void {
    const done = !item.done;
    this.api.updateChecklistItem(card.id, item.id, { done }).subscribe(() => {
      this.checklist.update((items) => items.map((i) => (i.id === item.id ? { ...i, done } : i)));
      this.syncCardChecklist(card.id);
    });
  }

  removeChecklistItem(card: Card, item: ChecklistItem): void {
    this.api.removeChecklistItem(card.id, item.id).subscribe(() => {
      this.checklist.update((items) => items.filter((i) => i.id !== item.id));
      this.syncCardChecklist(card.id);
    });
  }

  /** Card face and modal counter both read the card's checklist totals; recompute them from the modal's full list. */
  private syncCardChecklist(cardId: string): void {
    const items = this.checklist();
    const card = this.findCard(cardId);
    if (!card) return;
    this.patchCardLocally(cardId, {
      checklistDone: items.filter((i) => i.done).length,
      _count: { ...card._count, checklist: items.length },
    });
  }

  private findCard(id: string): Card | undefined {
    return this.lists().flatMap((l) => l.cards).find((c) => c.id === id);
  }

  // A completed due date is never overdue, however far in the past it is.
  isOverdue(card: Card): boolean {
    return !card.dueDone && card.dueDate !== null && new Date(card.dueDate).getTime() < Date.now();
  }

  formatDueDate(dueDate: string): string {
    return new Date(dueDate).toLocaleDateString('es', { month: 'short', day: 'numeric' });
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
