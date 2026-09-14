import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, tap, map, finalize, shareReplay, catchError } from 'rxjs';

export type Role = 'ADMIN' | 'MANAGER' | 'DEVELOPER';

export interface AuthUser {
  sub: string;
  email: string;
  role: Role;
}

interface AuthResponse {
  accessToken: string;
  user: AuthUser;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);

  private readonly accessTokenSignal = signal<string | null>(null);
  private readonly currentUserSignal = signal<AuthUser | null>(null);

  readonly currentUser = this.currentUserSignal.asReadonly();
  readonly isAuthenticated = computed(() => this.currentUserSignal() !== null);

  // Shared so a burst of 401s triggers a single refresh call, not one per request.
  private refreshInFlight: Observable<AuthResponse> | null = null;

  get accessToken(): string | null {
    return this.accessTokenSignal();
  }

  register(email: string, password: string): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>('/auth/register', { email, password }, { withCredentials: true })
      .pipe(tap((res) => this.setSession(res)));
  }

  login(email: string, password: string): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>('/auth/login', { email, password }, { withCredentials: true })
      .pipe(tap((res) => this.setSession(res)));
  }

  refresh(): Observable<AuthResponse> {
    this.refreshInFlight ??= this.http
      .post<AuthResponse>('/auth/refresh', {}, { withCredentials: true })
      .pipe(
        tap((res) => this.setSession(res)),
        finalize(() => (this.refreshInFlight = null)),
        shareReplay(1),
      );
    return this.refreshInFlight;
  }

  logout(): Observable<unknown> {
    return this.http.post('/auth/logout', {}, { withCredentials: true }).pipe(
      catchError(() => of(null)),
      finalize(() => this.clearSession()),
    );
  }

  /** Rebuilds the session from the refresh cookie after a page reload. */
  restoreSession(): Observable<boolean> {
    if (this.isAuthenticated()) return of(true);
    return this.refresh().pipe(
      map(() => true),
      catchError(() => of(false)),
    );
  }

  clearSession(): void {
    this.accessTokenSignal.set(null);
    this.currentUserSignal.set(null);
  }

  private setSession(res: AuthResponse): void {
    this.accessTokenSignal.set(res.accessToken);
    this.currentUserSignal.set(res.user);
  }
}
