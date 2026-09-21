import { ChangeDetectionStrategy, Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../auth/auth.service';
import { ThemeToggleComponent } from '../theme-toggle/theme-toggle.component';
import { Board, BoardsService } from '../boards/boards.service';

@Component({
  selector: 'app-dashboard',
  imports: [ThemeToggleComponent, ReactiveFormsModule, RouterLink],
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

  readonly form = inject(FormBuilder).nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(100)]],
  });

  constructor() {
    this.boardsApi.list().subscribe((boards) => this.boards.set(boards));
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
