import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { BaseRouteReuseStrategy, ActivatedRouteSnapshot, RouteReuseStrategy, provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';

import { routes } from './app.routes';
import { authInterceptor } from './auth/auth.interceptor';

class ReuseByIdStrategy extends BaseRouteReuseStrategy {
  override shouldReuseRoute(future: ActivatedRouteSnapshot, curr: ActivatedRouteSnapshot): boolean {
    return super.shouldReuseRoute(future, curr) && future.paramMap.get('id') === curr.paramMap.get('id');
  }
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    { provide: RouteReuseStrategy, useClass: ReuseByIdStrategy },
    provideHttpClient(withInterceptors([authInterceptor])),
  ],
};
