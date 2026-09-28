import { Routes } from '@angular/router';
import { authGuard } from './auth/auth.guard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'home' },
  {
    path: 'login',
    loadComponent: () => import('./auth/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'register',
    loadComponent: () =>
      import('./auth/register/register.component').then((m) => m.RegisterComponent),
  },
  {
    path: 'home',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./dashboard/dashboard.component').then((m) => m.DashboardComponent),
    data: { view: 'home' },
  },
  {
    path: 'boards',
    pathMatch: 'full',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./dashboard/dashboard.component').then((m) => m.DashboardComponent),
    data: { view: 'boards' },
  },
  {
    path: 'w/:id',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./dashboard/dashboard.component').then((m) => m.DashboardComponent),
    data: { view: 'boards' },
  },
  {
    path: 'join/w/:token',
    canActivate: [authGuard],
    loadComponent: () => import('./boards/join/join.component').then((m) => m.JoinComponent),
    data: { kind: 'workspace' },
  },
  {
    path: 'join/:token',
    canActivate: [authGuard],
    loadComponent: () => import('./boards/join/join.component').then((m) => m.JoinComponent),
  },
  {
    path: 'boards/:id',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./boards/board-detail.component').then((m) => m.BoardDetailComponent),
  },
  {
    path: '**',
    loadComponent: () => import('./not-found/not-found.component').then((m) => m.NotFoundComponent),
  },
];
