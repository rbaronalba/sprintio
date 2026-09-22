import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { DashboardComponent } from './dashboard.component';

@Component({ template: '' })
class BlankComponent {}

describe('DashboardComponent', () => {
  let fixture: ComponentFixture<DashboardComponent>;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        provideRouter([{ path: '**', component: BlankComponent }]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);

    TestBed.inject(AuthService).login('dev@sprintio.test', 'password123').subscribe();
    httpMock.expectOne('/auth/login').flush({
      accessToken: 'token-1',
      user: { sub: '1', email: 'dev@sprintio.test', role: 'DEVELOPER' },
    });

    fixture = TestBed.createComponent(DashboardComponent);
  });

  afterEach(() => httpMock.verify());

  it('shows the signed-in user', () => {
    httpMock.expectOne('/boards').flush([]);
    fixture.detectChanges();
    const user: HTMLElement = fixture.nativeElement.querySelector('[data-testid="current-user"]');
    expect(user.textContent).toBe('dev@sprintio.test');
  });

  it('only offers deleting boards the user owns', () => {
    const board = (id: string, ownerId: string) => ({ id, title: `Board ${id}`, ownerId });
    httpMock.expectOne('/boards').flush([board('mine', '1'), board('shared', '9')]);
    fixture.detectChanges();

    const rows: HTMLElement[] = Array.from(fixture.nativeElement.querySelectorAll('.board-tile:not(.board-tile--new)'));
    expect(rows.length).toBe(2);
    expect(rows[0].querySelector('button[aria-label="Remove board"]')).not.toBeNull();
    expect(rows[1].querySelector('button[aria-label="Remove board"]')).toBeNull();
  });

  it('logs out and returns to the login page', async () => {
    httpMock.expectOne('/boards').flush([]);
    fixture.componentInstance.logout();
    httpMock.expectOne('/auth/logout').flush(null);

    await fixture.whenStable();
    expect(TestBed.inject(AuthService).isAuthenticated()).toBe(false);
    expect(TestBed.inject(Router).url).toBe('/login');
  });
});
