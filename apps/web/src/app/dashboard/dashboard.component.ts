import { ChangeDetectionStrategy, Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Subject, debounceTime, distinctUntilChanged, switchMap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from '../auth/auth.service';
import { ThemeToggleComponent } from '../theme-toggle/theme-toggle.component';
import { NotificationBellComponent } from '../realtime/notification-bell.component';
import { Board, BoardsService, SearchHit } from '../boards/boards.service';

@Component({
  selector: 'app-dashboard',
  imports: [ThemeToggleComponent, ReactiveFormsModule, RouterLink, NotificationBellComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent {
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly boardsApi = inject(BoardsService);

  readonly boards = signal<Board[]>([]);
  readonly pending = signal(false);
  readonly creating = signal(false);
  readonly pendingDelete = signal<Board | null>(null);
  private readonly confirmDialog = viewChild.required<ElementRef<HTMLDialogElement>>('confirmDialog');
  private readonly profileDialog = viewChild.required<ElementRef<HTMLDialogElement>>('profileDialog');

  readonly searchTerm = signal('');
  readonly searchHits = signal<SearchHit[]>([]);
  private readonly searchInput = new Subject<string>();

  readonly form = inject(FormBuilder).nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(100)]],
  });

  constructor() {
    this.boardsApi.list().subscribe((boards) => this.boards.set(boards));

    this.searchInput
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        // switchMap, not mergeMap: a slow response for "ca" must never overwrite
        // the results for "card" the user has already typed.
        switchMap((term) => this.boardsApi.search(term)),
        takeUntilDestroyed(),
      )
      .subscribe((hits) => this.searchHits.set(hits));
  }

  search(term: string): void {
    this.searchTerm.set(term);
    this.searchInput.next(term.trim());
  }

  clearSearch(): void {
    this.searchTerm.set('');
    this.searchHits.set([]);
    this.searchInput.next('');
  }

  openHit(hit: SearchHit): void {
    this.clearSearch();
    void this.router.navigate(['/boards', hit.boardId], { queryParams: { card: hit.cardId } });
  }

  openProfile(): void {
    this.profileDialog().nativeElement.showModal();
  }

  saveProfile(displayName: string): void {
    this.auth.updateProfile(displayName.trim() || null).subscribe(() => {
      this.profileDialog().nativeElement.close();
    });
  }

  createBoard(): void {
    if (this.form.invalid) return;
    this.pending.set(true);
    const { title } = this.form.getRawValue();
    this.boardsApi.create(title).subscribe((board) => {
      this.boards.update((boards) => [board, ...boards]);
      this.form.reset();
      this.creating.set(false);
      this.pending.set(false);
    });
  }

  askDelete(board: Board): void {
    this.pendingDelete.set(board);
    this.confirmDialog().nativeElement.showModal();
  }

  confirmDelete(): void {
    const board = this.pendingDelete();
    if (board) this.removeBoard(board.id);
    this.confirmDialog().nativeElement.close();
  }

  removeBoard(id: string): void {
    this.boardsApi.remove(id).subscribe(() => {
      this.boards.update((boards) => boards.filter((b) => b.id !== id));
    });
  }

  logout(): void {
    this.auth.logout().subscribe(() => void this.router.navigate(['/login']));
  }
}
