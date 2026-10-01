import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/** Any URL no route matches, and boards that don't exist or the user can't see. */
@Component({
  selector: 'app-not-found',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main>
      <p class="code">404</p>
      <h1>Página no encontrada</h1>
      <p class="note">La página que buscas no existe o no tienes acceso a ella.</p>
      <a routerLink="/home" class="btn btn-primary">Ir al inicio</a>
    </main>
  `,
  styles: `
    :host { display: grid; place-items: center; min-height: 100vh; background: var(--canvas); }
    main { display: flex; flex-direction: column; align-items: center; gap: var(--space-xs); padding: var(--space-md); text-align: center; }
    .code { margin: 0; color: var(--primary); font-size: 96px; font-weight: 700; line-height: 1; }
    h1 { margin: 0; color: var(--ink); font-size: 24px; }
    .note { margin: 0 0 var(--space-xs); max-width: 360px; color: var(--body); }
    .btn { text-decoration: none; }
  `,
})
export class NotFoundComponent {}
