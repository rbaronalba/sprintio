import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../auth/auth.service';
import { AppHeaderComponent } from '../header/app-header.component';
import { Board, BoardsService, Member, Workspace } from '../services/boards.service';
import { avatarStyle, initials } from '../shared/avatar';
import { backgroundStyle } from '../shared/background';

const RECENT_COUNT = 3;

/**
 * One component, three routes: Home (/dashboard), all boards (/dashboard/boards) and a
 * single workspace's boards (/dashboard/w/:id). The sidebar is the same on all three.
 */
@Component({
  selector: 'app-dashboard',
  imports: [AppHeaderComponent, NgTemplateOutlet, ReactiveFormsModule, RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent {
  readonly auth = inject(AuthService);
  private readonly boardsApi = inject(BoardsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly header = viewChild.required(AppHeaderComponent);

  readonly view = signal<'home' | 'boards'>(this.route.snapshot.data['view'] ?? 'home');
  /** Set on /dashboard/w/:id: the boards view then shows just that workspace. */
  readonly workspaceId = signal(this.route.snapshot.paramMap.get('id'));

  readonly boards = signal<Board[]>([]);
  readonly workspaces = signal<Workspace[]>([]);
  readonly pending = signal(false);
  /** The workspace whose "Create new board" tile is showing its form. */
  readonly creatingIn = signal<string | null>(null);
  /** What the confirm dialog is about to delete: its name, the warning, and the action. */
  readonly pendingDelete = signal<{ title: string; warning: string; run: () => void; phrase: boolean } | null>(null);
  /** The workspace whose name is showing as an input. */
  readonly renamingWs = signal<string | null>(null);
  private readonly confirmDialog = viewChild.required<ElementRef<HTMLDialogElement>>('confirmDialog');
  private readonly workspaceDialog = viewChild.required<ElementRef<HTMLDialogElement>>('workspaceDialog');
  private readonly membersDialog = viewChild.required<ElementRef<HTMLDialogElement>>('membersDialog');

  /** The workspace whose Members dialog is open, and its member list. */
  readonly membersOf = signal<Workspace | null>(null);
  readonly members = signal<Member[]>([]);
  readonly shareLink = computed(() => {
    const token = this.membersOf()?.inviteToken;
    return token ? `${location.origin}/join/w/${token}` : null;
  });

  readonly avatarStyle = avatarStyle;
  readonly initials = initials;
  readonly bgStyle = backgroundStyle;

  readonly starred = computed(() => this.boards().filter((b) => b.starred));

  readonly recent = computed(() =>
    this.boards()
      .filter((b) => b.lastViewedAt)
      .sort((a, b) => b.lastViewedAt!.localeCompare(a.lastViewedAt!))
      .slice(0, RECENT_COUNT),
  );

  /** Workspaces to render with their boards; just the one on a workspace page. */
  readonly sections = computed(() => {
    const only = this.workspaceId();
    return this.workspaces()
      .filter((w) => !only || w.id === only)
      .map((w) => ({ workspace: w, boards: this.boards().filter((b) => b.workspaceId === w.id) }));
  });

  readonly form = inject(FormBuilder).nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(100)]],
  });

  constructor() {
    this.load();
  }

  private load(): void {
    this.boardsApi.list().subscribe((boards) => this.boards.set(boards));
    this.boardsApi.listWorkspaces().subscribe((ws) => this.workspaces.set(ws));
  }

  isOwner(w: Workspace): boolean {
    return w.ownerId === this.auth.currentUser()?.sub;
  }

  workspaceName(id: string): string {
    return this.workspaces().find((w) => w.id === id)?.name ?? '';
  }

  /** The header already owns the create-board dialog (with its workspace picker). */
  openCreateBoard(): void {
    this.header().openCreate();
  }

  startCreate(workspaceId: string): void {
    this.form.reset();
    this.creatingIn.set(workspaceId);
  }

  createBoard(workspaceId: string): void {
    if (this.form.invalid) return;
    this.pending.set(true);
    const { title } = this.form.getRawValue();
    this.boardsApi.create(title, workspaceId).subscribe({
      next: (board) => {
        this.boards.update((boards) => [{ ...board, starred: false, lastViewedAt: null }, ...boards]);
        this.form.reset();
        this.creatingIn.set(null);
        this.pending.set(false);
      },
      error: () => this.pending.set(false),
    });
  }

  openCreateWorkspace(): void {
    this.workspaceDialog().nativeElement.showModal();
  }

  createWorkspace(field: HTMLInputElement): void {
    const name = field.value.trim();
    if (!name) return;
    this.boardsApi.createWorkspace(name).subscribe((ws) => {
      this.workspaces.update((list) => [...list, ws]);
      field.value = '';
      this.workspaceDialog().nativeElement.close();
    });
  }

  /** Optimistic, rolled back if the API refuses. */
  toggleStar(board: Board): void {
    const set = (starred: boolean) =>
      this.boards.update((boards) => boards.map((b) => (b.id === board.id ? { ...b, starred } : b)));
    set(!board.starred);
    this.boardsApi.setStarred(board.id, !board.starred).subscribe({ error: () => set(board.starred) });
  }

  askDelete(board: Board): void {
    this.confirm(board.title, 'También se eliminarán todas sus listas y tarjetas. Esta acción no se puede deshacer.', () =>
      this.boardsApi.remove(board.id).subscribe(() => {
        this.boards.update((boards) => boards.filter((b) => b.id !== board.id));
      }),
    );
  }

  askDeleteWorkspace(w: Workspace): void {
    this.confirm(w.name, 'También se eliminarán todos los tableros de este espacio de trabajo, con sus listas y tarjetas. Esta acción no se puede deshacer.', () =>
      this.boardsApi.removeWorkspace(w.id).subscribe(() => {
        this.workspaces.update((list) => list.filter((x) => x.id !== w.id));
        this.boards.update((boards) => boards.filter((b) => b.workspaceId !== w.id));
        if (this.workspaceId() === w.id) void this.router.navigate(['/boards']);
      }),
    );
  }

  /** Saves on Enter/blur; an empty or unchanged name just closes the input. */
  renameWorkspace(w: Workspace, value: string): void {
    if (this.renamingWs() !== w.id) return; // blur after Enter/Escape already handled it
    this.renamingWs.set(null);
    const name = value.trim();
    if (!name || name === w.name) return;
    this.boardsApi.renameWorkspace(w.id, name).subscribe((updated) => {
      this.workspaces.update((list) => list.map((x) => (x.id === w.id ? updated : x)));
    });
  }

  openMembers(w: Workspace): void {
    this.membersOf.set(w);
    this.members.set([]);
    this.boardsApi.workspaceMembers(w.id).subscribe((m) => this.members.set(m));
    this.membersDialog().nativeElement.showModal();
  }

  createInvite(): void {
    const w = this.membersOf();
    if (!w) return;
    this.boardsApi.createWorkspaceInvite(w.id).subscribe(({ token }) => this.setInviteToken(w.id, token));
  }

  stopSharing(): void {
    const w = this.membersOf();
    if (!w) return;
    this.boardsApi.revokeWorkspaceInvite(w.id).subscribe(() => this.setInviteToken(w.id, null));
  }

  private setInviteToken(id: string, inviteToken: string | null): void {
    this.workspaces.update((list) => list.map((x) => (x.id === id ? { ...x, inviteToken } : x)));
    this.membersOf.update((w) => (w ? { ...w, inviteToken } : w));
  }

  copyLink(input: HTMLInputElement): void {
    input.select();
    void navigator.clipboard?.writeText(input.value);
  }

  /**
   * Remove someone, or pass yourself to leave. The Members dialog closes first: the confirm
   * dialog lives outside it, and a modal dialog makes everything outside it inert.
   */
  askRemoveMember(m: Member): void {
    const w = this.membersOf();
    if (!w) return;
    const leaving = m.userId === this.auth.currentUser()?.sub;
    this.membersDialog().nativeElement.close();
    this.confirm(
      leaving ? `salir de ${w.name}` : `quitar a ${m.displayName || m.email} de ${w.name}`,
      leaving
        ? 'Perderás el acceso a sus tableros, salvo los que hayas creado tú.'
        : 'Perderá el acceso a sus tableros, salvo los que haya creado.',
      () =>
        this.boardsApi.removeWorkspaceMember(w.id, m.userId).subscribe(() => {
          if (!leaving) return;
          if (this.workspaceId() === w.id) void this.router.navigate(['/boards']);
          this.load();
        }),
      true,
    );
  }

  /** `phrase`: the title is the whole action ("leave X") rather than a thing to delete. */
  private confirm(title: string, warning: string, run: () => void, phrase = false): void {
    this.pendingDelete.set({ title, warning, run, phrase });
    this.confirmDialog().nativeElement.showModal();
  }

  confirmDelete(): void {
    this.pendingDelete()?.run();
    this.confirmDialog().nativeElement.close();
  }
}
