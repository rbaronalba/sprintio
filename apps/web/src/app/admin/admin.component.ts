import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { AuthService, Role } from '../auth/auth.service';
import { AppHeaderComponent } from '../header/app-header.component';

interface AdminUser {
  id: string;
  email: string;
  displayName: string | null;
  role: Role;
  disabledAt: string | null;
  /** Boards + workspaces this user owns: what "Transfer" would move. */
  owned: number;
}

/** User administration, reached from the account menu. The API enforces the ADMIN role. */
@Component({
  selector: 'app-admin',
  imports: [RouterLink, AppHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-header />
    <main>
      <a routerLink="/home" class="back">&larr; Volver</a>
      <h1>Usuarios</h1>
      @if (notice(); as n) {
        <p class="note" role="status">{{ n }}</p>
      }
      <table>
        <thead>
          <tr><th>Usuario</th><th>Rol</th><th>Estado</th><th>Acciones</th></tr>
        </thead>
        <tbody>
          @for (u of users(); track u.id) {
            <tr>
              <td>
                {{ u.displayName || u.email }}
                <span class="muted">{{ u.email }}</span>
              </td>
              <td>
                <select #role aria-label="Rol" [disabled]="u.id === me" (change)="patch(u, { role: role.value })">
                  @for (r of roles; track r) {
                    <option [value]="r" [selected]="r === u.role">{{ r }}</option>
                  }
                </select>
              </td>
              <td>{{ u.disabledAt ? 'Desactivado' : 'Activo' }}</td>
              <td class="actions">
                @if (u.id !== me) {
                  <button type="button" class="btn btn-outline" (click)="setDisabled(u)">{{ u.disabledAt ? 'Activar' : 'Desactivar' }}</button>
                  <button type="button" class="btn btn-outline" (click)="resetPassword(u)">Restablecer contraseña</button>
                }
                @if (u.owned) {
                  <select #to aria-label="Traspasar tableros a" (change)="transfer(u, to)">
                    <option value="">Traspasar sus {{ u.owned }} tableros/espacios a&hellip;</option>
                    @for (t of users(); track t.id) {
                      @if (t.id !== u.id && !t.disabledAt) {
                        <option [value]="t.id">{{ t.displayName || t.email }}</option>
                      }
                    }
                  </select>
                }
              </td>
            </tr>
          }
        </tbody>
      </table>
    </main>
  `,
  styles: `
    :host { display: block; min-height: 100vh; background: var(--canvas); }
    main { max-width: 1000px; margin: 0 auto; padding: var(--space-lg) var(--space-sm); }
    .back { color: var(--body); text-decoration: none; }
    h1 { margin: var(--space-xs) 0; font-size: 26px; font-weight: 500; }
    .note { color: var(--body); user-select: all; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: var(--space-xxs); text-align: left; border-bottom: 1px solid var(--hairline); }
    .muted { display: block; color: var(--muted); font-size: 13px; }
    .actions { display: flex; flex-wrap: wrap; gap: var(--space-xxs); }
  `,
})
export class AdminComponent {
  private readonly http = inject(HttpClient);
  readonly me = inject(AuthService).currentUser()?.sub;
  readonly roles: Role[] = ['ADMIN', 'MANAGER', 'DEVELOPER'];
  readonly users = signal<AdminUser[]>([]);
  readonly notice = signal('');

  private readonly fail = (e: HttpErrorResponse) =>
    this.notice.set(e.status === 403 ? 'Solo los administradores pueden gestionar usuarios.' : (e.error?.message ?? 'Algo ha fallado'));

  constructor() {
    this.load();
  }

  private load(): void {
    this.http.get<AdminUser[]>('/auth/admin/users').subscribe({ next: (users) => this.users.set(users), error: this.fail });
  }

  patch(user: AdminUser, body: { role?: string; disabled?: boolean }): void {
    this.http.patch(`/auth/admin/users/${user.id}`, body).subscribe({ next: () => this.load(), error: this.fail });
  }

  setDisabled(user: AdminUser): void {
    const disable = !user.disabledAt;
    if (disable && !confirm(`¿Desactivar a ${user.email}? Se cerrará su sesión y no podrá volver a entrar.`)) return;
    this.patch(user, { disabled: disable });
  }

  resetPassword(user: AdminUser): void {
    if (!confirm(`¿Restablecer la contraseña de ${user.email}? Se cerrará su sesión en todos los dispositivos.`)) return;
    this.http.post<{ password: string }>(`/auth/admin/users/${user.id}/password`, {}).subscribe({
      next: ({ password }) => this.notice.set(`Nueva contraseña de ${user.email}: ${password} (solo se muestra una vez; pídele que la cambie)`),
      error: this.fail,
    });
  }

  transfer(user: AdminUser, select: HTMLSelectElement): void {
    const toUserId = select.value;
    select.value = '';
    if (!toUserId || !confirm(`¿Traspasar todos los tableros y espacios de trabajo de ${user.email}?`)) return;
    this.http.post<{ boards: number; workspaces: number }>(`/auth/admin/users/${user.id}/transfer`, { toUserId }).subscribe({
      next: (r) => {
        this.notice.set(`Traspasados ${r.boards} tableros y ${r.workspaces} espacios de trabajo.`);
        this.load();
      },
      error: this.fail,
    });
  }
}
