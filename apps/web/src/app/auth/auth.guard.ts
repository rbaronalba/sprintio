import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { AuthService, Role } from './auth.service';

export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return auth
    .restoreSession()
    .pipe(map((ok) => ok || router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } })));
};

export const roleGuard = (...roles: Role[]): CanActivateFn => {
  return () => {
    const auth = inject(AuthService);
    const router = inject(Router);

    return auth.restoreSession().pipe(
      map((ok) => {
        if (!ok) return router.createUrlTree(['/login']);
        const user = auth.currentUser();
        return user !== null && roles.includes(user.role) ? true : router.createUrlTree(['/']);
      }),
    );
  };
};
