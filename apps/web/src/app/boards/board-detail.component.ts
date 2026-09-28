import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, inject, signal, viewChild } from '@angular/core';
import { NgTemplateOutlet, TitleCasePipe } from '@angular/common';
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
import { RealtimeService } from '../realtime/realtime.service';
import { actorName, describeEvent, relativeTime } from '../realtime/activity';
import { ActivityEntry, Board, BoardDetail, BoardsService, Label, Member } from '../services/boards.service';
import { Attachment, BoardService, Card, ChecklistItem, Comment, List, TimeEntry } from '../services/board.service';
import { positionAt } from '../shared/position';
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
    TitleCasePipe,
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
  readonly comments = signal<Comment[]>([]);
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
  // Local-only, not persisted: there's no CardFollower table. Add one if people actually
  // want a notification when a card they follow (rather than are assigned to) changes.
  private readonly followedCardIds = signal<ReadonlySet<string>>(new Set());
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('cardDialog');
  /** `verb` replaces "delete" for actions that can be undone (removing a member, leaving). */
  readonly pendingDelete = signal<{ name: string; note?: string; verb?: string; run: () => void } | null>(null);
  private readonly confirmDialog = viewChild.required<ElementRef<HTMLDialogElement>>('confirmDialog');
  private dragging = false;
  /** A remote change that arrived mid-drag, replayed once the drag finishes. */
  private refreshQueued = false;
  private readonly remoteChange = new Subject<void>();

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
        filter((message) => message.boardId === this.boardId && message.actorId !== this.currentUserId),
        takeUntilDestroyed(),
      )
      .subscribe((message) => {
        if (message.type === 'MEMBER_REMOVED' && message.data['userId'] === this.currentUserId) {
          void this.router.navigate(['/home']);
          return;
        }
        if (message.type.startsWith('MEMBER_') || message.type === 'BACKGROUND_CHANGED' || message.type === 'BOARD_RENAMED') {
          this.boardsApi.get(this.boardId).subscribe((board) => this.board.set(board));
        }
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
    this.editingTitle.set(false);
    this.comments.set([]);
    this.timeEntries.set([]);
    this.attachments.set([]);
    this.checklist.set([]);
    this.activity.set([]);
    this.pendingFile.set(null);
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
    const position = positionAt(target.cards, target.cards.length);
    this.lists.update((lists) =>
      lists.map((l) => {
        if (l.id === card.listId) return { ...l, cards: l.cards.filter((c) => c.id !== card.id) };
        if (l.id === listId) return { ...l, cards: [...l.cards, { ...card, listId, position }] };
        return l;
      }),
    );
    this.patchCardLocally(card.id, { listId, position });
    this.api.moveCard(card.id, listId, position).subscribe();
  }

  copyCard(card: Card): void {
    this.api.createCard(card.listId, `${card.title} (copy)`).subscribe((copy) => {
      const patch = { description: card.description };
      this.api.updateCard(copy.id, patch).subscribe();
      this.lists.update((lists) =>
        lists.map((l) => (l.id === card.listId ? { ...l, cards: [...l.cards, { ...copy, ...patch }] } : l)),
      );
    });
  }

  isFollowed(card: Card): boolean {
    return this.followedCardIds().has(card.id);
  }

  toggleFollow(card: Card): void {
    this.followedCardIds.update((ids) => toggled(ids, card.id));
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
      verb: 'remove',
      note: 'They lose access to this board and are unassigned from its cards.',
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

  askLeave(): void {
    const me = this.currentUserId;
    if (!me) return;
    this.pendingDelete.set({
      name: this.board()?.title ?? 'this board',
      verb: 'leave',
      note: 'You will need a new invite link to come back.',
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

  private bumpCounts(cardId: string, comments: number, attachments: number): void {
    this.lists.update((lists) =>
      lists.map((l) => ({
        ...l,
        cards: l.cards.map((c) =>
          c.id === cardId
            ? { ...c, _count: { comments: c._count.comments + comments, attachments: c._count.attachments + attachments } }
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

  totalHours(card: Card): number {
    return card.timeEntries.reduce((sum, e) => sum + e.hours, 0);
  }

  openTime(button: HTMLElement, pop: HTMLElement): void {
    this.timeMemberId.set(this.currentUserId ?? '');
    this.timeHours.set('');
    this.timeDate.set(new Date().toISOString().slice(0, 10));
    this.timeNote.set('');
    pop.showPopover();
    this.placePopover(pop, button.getBoundingClientRect());
  }

  /** Hours as typed, or null when it isn't something the API would accept (0 < h <= 24). */
  timeHoursValue(): number | null {
    const hours = Number(this.timeHours().replace(',', '.'));
    return Number.isFinite(hours) && hours > 0 && hours <= 24 ? hours : null;
  }

  addTimeEntry(card: Card, pop: HTMLElement): void {
    const hours = this.timeHoursValue();
    const date = this.timeDate();
    if (hours === null || !date) return;
    const userId = this.timeMemberId() || undefined;
    this.api.addTimeEntry(card.id, date, hours, this.timeNote().trim() || undefined, userId).subscribe((entry) => {
      this.timeEntries.update((entries) => [entry, ...entries]);
      pop.hidePopover();
      // Via patchCardLocally so the modal's total updates too, not just the card face.
      const current = this.lists().flatMap((l) => l.cards).find((c) => c.id === card.id) ?? card;
      this.patchCardLocally(card.id, { timeEntries: [...current.timeEntries, { hours: entry.hours }] });
    });
  }

  removeTimeEntry(card: Card, entry: TimeEntry): void {
    this.api.removeTimeEntry(card.id, entry.id).subscribe(() => {
      this.timeEntries.update((entries) => entries.filter((e) => e.id !== entry.id));
      // The card face only keeps bare hours (no id) for the total; drop one matching value.
      const current = this.lists().flatMap((l) => l.cards).find((c) => c.id === card.id) ?? card;
      const rest = [...current.timeEntries];
      const i = rest.findIndex((h) => h.hours === entry.hours);
      if (i !== -1) rest.splice(i, 1);
      this.patchCardLocally(card.id, { timeEntries: rest });
    });
  }

  formatEntryDate(date: string): string {
    return new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
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
