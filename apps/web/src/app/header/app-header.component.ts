import { ChangeDetectionStrategy, Component, ElementRef, HostListener, inject, signal, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged, switchMap, tap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from '../auth/auth.service';
import { NotificationBellComponent } from '../realtime/notification-bell.component';
import { Board, BoardsService, SearchHit, Workspace } from '../services/boards.service';
import { avatarStyle, initials } from '../shared/avatar';

@Component({
  selector: 'app-header',
  imports: [RouterLink, NotificationBellComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app-header.component.html',
  styleUrl: './app-header.component.scss',
})
export class AppHeaderComponent {
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly boardsApi = inject(BoardsService);
  private readonly profileDialog = viewChild.required<ElementRef<HTMLDialogElement>>('profileDialog');

  private readonly createDialog = viewChild.required<ElementRef<HTMLDialogElement>>('createDialog');

  readonly avatarStyle = avatarStyle;
  readonly initials = initials;

  readonly searchOpen = signal(false);
  readonly menuOpen = signal(false);
  readonly term = signal('');
  readonly hits = signal<SearchHit[]>([]);
  /** The term `hits` belongs to, so "nothing found" never flashes while a request is in flight. */
  readonly answeredFor = signal('');
  readonly recent = signal<Board[]>([]);
  /** Workspaces the user can add boards to (the ones they are a member of), for the create dialog. */
  readonly ownWorkspaces = signal<Workspace[]>([]);
  /** The "+ Create workspace" option is picked: the dialog shows a name field for it. */
  readonly newWorkspace = signal(false);
  readonly NEW_WS = '__new__';
  private readonly newWsField = viewChild<ElementRef<HTMLInputElement>>('newWsField');
  private readonly input$ = new Subject<string>();

  constructor() {
    this.input$
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        // switchMap: a slow answer for "ca" must not overwrite the results for "card".
        switchMap((t) =>
          this.boardsApi.search(t).pipe(
            tap((h) => {
              this.hits.set(h);
              this.answeredFor.set(t);
            }),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe();
  }

  /** Two characters is the API's minimum; below that the dropdown shows recent boards. */
  get searching(): boolean {
    return this.term().trim().length >= 2;
  }

  openSearch(): void {
    this.searchOpen.set(true);
    this.boardsApi.list().subscribe((boards) =>
      this.recent.set(
        // Opened ones first, most recent on top; never-opened ones after, newest first (API order).
        [...boards]
          .sort((a, b) => (b.lastViewedAt ?? '').localeCompare(a.lastViewedAt ?? ''))
          .slice(0, 10),
      ),
    );
  }

  closeSearch(): void {
    this.searchOpen.set(false);
  }

  onInput(value: string): void {
    this.term.set(value);
    this.input$.next(value.trim());
  }

  openBoard(id: string, cardId?: string): void {
    this.closeSearch();
    this.term.set('');
    void this.router.navigate(['/boards', id], cardId ? { queryParams: { card: cardId } } : {});
  }

  openCreate(): void {
    this.newWorkspace.set(false);
    this.boardsApi.listWorkspaces().subscribe((ws) => this.ownWorkspaces.set(ws.filter((w) => w.isMember)));
    this.createDialog().nativeElement.showModal();
  }

  /**
   * No workspace picked (user owns none yet): the API files it in a new default one.
   * "+ Create workspace" picked: the named workspace is created first, then the board in it.
   */
  createBoard(title: string, workspaceId: string): void {
    if (!title.trim()) return;
    if (workspaceId === this.NEW_WS) {
      const name = this.newWsField()?.nativeElement.value.trim();
      if (!name) return;
      this.boardsApi.createWorkspace(name).subscribe((ws) => {
        this.ownWorkspaces.update((list) => [...list, ws]);
        this.createBoard(title, ws.id);
      });
      return;
    }
    this.boardsApi.create(title.trim(), workspaceId || undefined).subscribe((b) => {
      this.createDialog().nativeElement.close();
      this.openBoard(b.id);
    });
  }

  /** A click anywhere outside the search or account dropdown closes it. */
  @HostListener('document:mousedown', ['$event'])
  closeDropdowns(event: MouseEvent): void {
    const target = event.target as Element;
    if (!target.closest('.search')) this.searchOpen.set(false);
    if (!target.closest('.account')) this.menuOpen.set(false);
  }

  openProfile(): void {
    this.menuOpen.set(false);
    this.profileDialog().nativeElement.showModal();
  }

  openAdmin(): void {
    this.menuOpen.set(false);
    void this.router.navigate(['/admin']);
  }

  saveProfile(displayName: string): void {
    this.auth.updateProfile(displayName.trim() || null).subscribe(() => {
      this.profileDialog().nativeElement.close();
    });
  }

  logout(): void {
    this.auth.logout().subscribe(() => void this.router.navigate(['/login']));
  }
}
