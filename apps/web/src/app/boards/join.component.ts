import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { BoardsService, InvitePreview } from './boards.service';
import { ThemeToggleComponent } from '../theme-toggle/theme-toggle.component';

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
  private readonly token = inject(ActivatedRoute).snapshot.paramMap.get('token')!;

  readonly invite = signal<InvitePreview | null>(null);
  readonly invalid = signal(false);
  readonly pending = signal(false);

  constructor() {
    this.api.previewInvite(this.token).subscribe({
      next: (invite) => this.invite.set(invite),
      error: () => this.invalid.set(true),
    });
  }

  join(): void {
    this.pending.set(true);
    this.api.join(this.token).subscribe({
      next: ({ boardId }) => void this.router.navigate(['/boards', boardId]),
      error: () => {
        this.pending.set(false);
        this.invalid.set(true);
      },
    });
  }
}
