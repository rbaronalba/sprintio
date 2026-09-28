import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Observable, map } from 'rxjs';
import { BoardsService } from '../../services/boards.service';
import { ThemeToggleComponent } from '../../theme-toggle/theme-toggle.component';

@Component({
  selector: 'app-join',
  imports: [RouterLink, ThemeToggleComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './join.component.html',
  styleUrl: './join.component.scss',
})
export class JoinComponent {
  private readonly api = inject(BoardsService);
  private readonly router = inject(Router);
  private readonly snapshot = inject(ActivatedRoute).snapshot;
  private readonly token = this.snapshot.paramMap.get('token')!;
  /** /join/w/:token invites to a whole workspace, /join/:token to one board. */
  readonly isWorkspace = this.snapshot.data['kind'] === 'workspace';

  /** Either invite, normalized: its name, whether I'm in already, and where it lives. */
  readonly invite = signal<{ title: string; isMember: boolean; link: string[] } | null>(null);
  readonly invalid = signal(false);
  readonly pending = signal(false);

  constructor() {
    // Invite tokens are 48 hex chars. Anything else never reaches the API, so a crafted
    // link like /join/..%2F..%2Fauth%2Flogout cannot steer the request elsewhere.
    if (!/^[0-9a-f]{48}$/.test(this.token)) {
      this.invalid.set(true);
      return;
    }
    const preview: Observable<{ title: string; isMember: boolean; link: string[] }> = this.isWorkspace
      ? this.api.previewWorkspaceInvite(this.token).pipe(
          map((w) => ({ title: w.name, isMember: w.isMember, link: ['/w', w.workspaceId] })),
        )
      : this.api.previewInvite(this.token).pipe(
          map((b) => ({ title: b.title, isMember: b.isMember, link: ['/boards', b.boardId] })),
        );
    preview.subscribe({
      next: (invite) => this.invite.set(invite),
      error: () => this.invalid.set(true),
    });
  }

  join(): void {
    this.pending.set(true);
    const joined: Observable<string[]> = this.isWorkspace
      ? this.api.joinWorkspace(this.token).pipe(map(({ workspaceId }) => ['/w', workspaceId]))
      : this.api.join(this.token).pipe(map(({ boardId }) => ['/boards', boardId]));
    joined.subscribe({
      next: (link) => void this.router.navigate(link),
      error: () => {
        this.pending.set(false);
        this.invalid.set(true);
      },
    });
  }
}
