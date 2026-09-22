import { Routes } from '@angular/router';
import { authGuard } from './auth/auth.guard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  { path: 'boards', pathMatch: 'full', redirectTo: 'dashboard' },
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
    path: 'dashboard',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./dashboard/dashboard.component').then((m) => m.DashboardComponent),
  },
  {
    path: 'join/:token',
    canActivate: [authGuard],
    loadComponent: () => import('./boards/join.component').then((m) => m.JoinComponent),
  },
  {
    path: 'boards/:id',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./boards/board-detail.component').then((m) => m.BoardDetailComponent),
  },
];
