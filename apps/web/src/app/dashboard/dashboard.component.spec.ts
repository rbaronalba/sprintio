import { Component } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
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
      user: { sub: '1', email: 'dev@sprintio.test', role: 'DEVELOPER', displayName: null },
    });

    fixture = TestBed.createComponent(DashboardComponent);
  });

  // Logging in opens the live stream and loads the bell; neither is what these tests
  // are about, so they are answered once here rather than in every case.
  const flushSessionRequests = () => {
    httpMock.match('/events/ticket').forEach((req) => req.flush({ ticket: 'stream-ticket' }));
    httpMock.match('/notifications').forEach((req) => req.flush({ unread: 0, items: [] }));
  };

  afterEach(() => {
    flushSessionRequests();
    httpMock.verify();
  });

  it('shows the signed-in user', () => {
    httpMock.expectOne('/boards').flush([]);
    fixture.detectChanges();
    const user: HTMLElement = fixture.nativeElement.querySelector('[data-testid="current-user"]');
    expect(user.textContent).toBe('dev@sprintio.test');
  });

  it('prefers the display name over the email once one is set', () => {
    httpMock.expectOne('/boards').flush([]);
    fixture.componentInstance.saveProfile('  Rubén  ');
    const req = httpMock.expectOne('/auth/profile');
    expect(req.request.body).toEqual({ displayName: 'Rubén' });
    req.flush({ sub: '1', email: 'dev@sprintio.test', role: 'DEVELOPER', displayName: 'Rubén' });

    fixture.detectChanges();
    const user: HTMLElement = fixture.nativeElement.querySelector('[data-testid="current-user"]');
    expect(user.textContent).toBe('Rubén');
  });

  it('debounces search and ignores terms shorter than two characters', fakeAsync(() => {
    httpMock.expectOne('/boards').flush([]);

    fixture.componentInstance.search('c');
    tick(300);
    httpMock.expectNone((req) => req.url === '/search');

    fixture.componentInstance.search('carburador');
    tick(300);
    const req = httpMock.expectOne((r) => r.url === '/search');
    expect(req.request.params.get('q')).toBe('carburador');
    req.flush([]);
  }));

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
