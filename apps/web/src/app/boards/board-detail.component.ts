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
import { ThemeToggleComponent } from '../theme-toggle/theme-toggle.component';
import { AuthService } from '../auth/auth.service';
import { BoardDetail, BoardsService, Member } from './boards.service';
import { BoardService, Card, List } from './board.service';
import { positionAt } from './position';

@Component({
  selector: 'app-board-detail',
  imports: [RouterLink, ThemeToggleComponent, CdkDropList, CdkDrag, CdkDragHandle],
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

  readonly boardId = this.route.snapshot.paramMap.get('id')!;
  readonly lists = signal<List[]>([]);
  readonly board = signal<BoardDetail | null>(null);
  readonly members = computed(() => this.board()?.members ?? []);
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

  get listIds(): string[] {
    return this.lists().map((l) => l.id);
  }

  constructor() {
    this.api.listLists(this.boardId).subscribe((lists) => this.lists.set(lists));
    this.boardsApi.get(this.boardId).subscribe({
      next: (board) => this.board.set(board),
      error: () => void this.router.navigate(['/dashboard']),
    });
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
    setTimeout(() => (this.dragging = false));
  }

  openCard(card: Card): void {
    if (this.dragging) return;
    this.editing.set(card);
    this.dialog().nativeElement.showModal();
  }

  saveCard(title: string, description: string): void {
    const card = this.editing();
    title = title.trim();
    if (!card || !title) return;
    const patch = { title, description: description.trim() || null };
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
