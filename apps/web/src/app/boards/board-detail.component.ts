import { ChangeDetectionStrategy, Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  CdkDrag,
  CdkDragDrop,
  CdkDragHandle,
  CdkDropList,
  moveItemInArray,
  transferArrayItem,
} from '@angular/cdk/drag-drop';
import { ThemeToggleComponent } from '../theme-toggle/theme-toggle.component';
import { BoardsService } from './boards.service';
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

  readonly boardId = this.route.snapshot.paramMap.get('id')!;
  readonly lists = signal<List[]>([]);
  readonly boardTitle = signal('');
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
    // ponytail: no GET /boards/:id yet, so find the title in the list
    this.boardsApi
      .list()
      .subscribe((boards) => this.boardTitle.set(boards.find((b) => b.id === this.boardId)?.title ?? ''));
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
}
