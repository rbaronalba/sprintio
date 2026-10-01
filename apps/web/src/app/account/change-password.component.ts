import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { AppHeaderComponent } from '../header/app-header.component';

/** Reached from the profile dialog's "Change password" button. */
@Component({
  selector: 'app-change-password',
  imports: [RouterLink, AppHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-header />
    <main>
      <a routerLink="/home" class="back">&larr; Volver</a>
      <h1>Cambiar contraseña</h1>
      @if (auth.currentUser()?.hasPassword) {
        <p class="note">Seguirás con la sesión iniciada aquí; se cerrará en tus otros dispositivos.</p>
        <form #form (submit)="$event.preventDefault(); submit(form, current.value, next.value, confirm.value)">
          <label class="label-caps" for="current-password">Contraseña actual</label>
          <input #current id="current-password" type="password" autocomplete="current-password" required maxlength="128" />
          <label class="label-caps" for="new-password">Nueva contraseña</label>
          <input #next id="new-password" type="password" autocomplete="new-password" required minlength="8" maxlength="128" />
          <label class="label-caps" for="confirm-password">Repite la nueva contraseña</label>
          <input #confirm id="confirm-password" type="password" autocomplete="new-password" required minlength="8" maxlength="128" />
          @if (message(); as m) {
            <p class="msg" [class.ok]="m.ok" role="status">{{ m.text }}</p>
          }
          <button type="submit" class="btn btn-primary" [disabled]="pending()">
            {{ pending() ? 'Guardando…' : 'Cambiar contraseña' }}
          </button>
        </form>
      } @else {
        <p class="note">Inicias sesión con Microsoft, así que aquí no hay contraseña que cambiar.</p>
      }
    </main>
  `,
  styles: `
    :host { display: block; min-height: 100vh; background: var(--canvas); }
    main { max-width: 420px; margin: 0 auto; padding: var(--space-lg) var(--space-sm); }
    .back { color: var(--body); text-decoration: none; }
    .back:hover { color: var(--ink); }
    h1 { margin: var(--space-xs) 0 var(--space-xxs); font-size: 26px; font-weight: 500; }
    .note { margin: 0 0 var(--space-sm); color: var(--body); }
    form { display: flex; flex-direction: column; gap: var(--space-xxs); }
    label { margin-top: var(--space-xxs); color: var(--body); }
    input { height: 44px; }
    .msg { margin: var(--space-xxs) 0 0; color: var(--primary); }
    .msg.ok { color: var(--body); }
    .btn { margin-top: var(--space-xs); align-self: flex-start; }
  `,
})
export class ChangePasswordComponent {
  readonly auth = inject(AuthService);
  readonly pending = signal(false);
  readonly message = signal<{ ok: boolean; text: string } | null>(null);

  submit(form: HTMLFormElement, current: string, next: string, confirm: string): void {
    if (next !== confirm) return this.message.set({ ok: false, text: 'Las contraseñas nuevas no coinciden' });
    if (next.length < 8) return this.message.set({ ok: false, text: 'Usa al menos 8 caracteres' });
    this.pending.set(true);
    this.auth.changePassword(current, next).subscribe({
      next: () => {
        form.reset();
        this.pending.set(false);
        this.message.set({ ok: true, text: 'Contraseña cambiada. Se cerró la sesión en tus otros dispositivos.' });
      },
      error: (e: HttpErrorResponse) => {
        this.pending.set(false);
        this.message.set({ ok: false, text: e.error?.message ?? 'No se pudo cambiar la contraseña' });
      },
    });
  }
}
