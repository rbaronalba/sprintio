import { inject } from '@angular/core';
import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { Router } from '@angular/router';
import { catchError, switchMap, throwError } from 'rxjs';
import { AuthService } from './auth.service';
import { CLIENT_ID } from '../realtime/realtime.service';

const AUTH_ENDPOINTS = ['/auth/login', '/auth/register', '/auth/refresh'];

function withToken(req: HttpRequest<unknown>, token: string | null): HttpRequest<unknown> {
  // X-Client-Id comes back on the live events this request causes; see CLIENT_ID.
  return req.clone({ setHeaders: { 'X-Client-Id': CLIENT_ID, ...(token && { Authorization: `Bearer ${token}` }) } });
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  // Retrying these would loop: a failed login/refresh is a real failure, not a stale token.
  if (AUTH_ENDPOINTS.some((endpoint) => req.url.includes(endpoint))) {
    return next(req);
  }

  const auth = inject(AuthService);
  const router = inject(Router);

  return next(withToken(req, auth.accessToken)).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status !== 401) return throwError(() => error);

      return auth.refresh().pipe(
        switchMap(() => next(withToken(req, auth.accessToken))),
        catchError((refreshError) => {
          auth.clearSession();
          void router.navigate(['/login']);
          return throwError(() => refreshError);
        }),
      );
    }),
  );
};
