import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of } from 'rxjs';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../auth.service';

/** What the api's Microsoft callback sends back in ?error= when it could not sign you in. */
const MICROSOFT_ERRORS: Record<string, string> = {
  microsoft: 'No se pudo completar el inicio de sesión con Microsoft. Inténtalo de nuevo.',
  'microsoft-linked': 'Este correo ya está vinculado a otra cuenta de Microsoft.',
};

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly pending = signal(false);
  readonly error = signal<string | null>(MICROSOFT_ERRORS[this.route.snapshot.queryParamMap.get('error') ?? ''] ?? null);
  readonly microsoft = toSignal(
    this.auth.providers().pipe(
      map((p) => p.microsoft),
      catchError(() => of(false)),
    ),
    { initialValue: false },
  );

  readonly form = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email, Validators.maxLength(254)]],
    password: ['', [Validators.required, Validators.minLength(8), Validators.maxLength(128)]],
  });

  submit(): void {
    if (this.form.invalid) return;
    this.pending.set(true);
    this.error.set(null);

    const { email, password } = this.form.getRawValue();
    this.auth.login(email, password).subscribe({
      next: () => {
        // Only in-app paths: a returnUrl like '//evil.com' must never leave the site.
        const back = this.route.snapshot.queryParamMap.get('returnUrl');
        void this.router.navigateByUrl(back?.startsWith('/') && !back.startsWith('//') ? back : '/home');
      },
      error: () => {
        this.pending.set(false);
        this.error.set('Correo o contraseña incorrectos');
      },
    });
  }
}
