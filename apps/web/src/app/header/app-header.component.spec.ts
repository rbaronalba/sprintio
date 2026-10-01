import { Component } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { AppHeaderComponent } from './app-header.component';

@Component({ template: '' })
class BlankComponent {}

describe('AppHeaderComponent', () => {
  let fixture: ComponentFixture<AppHeaderComponent>;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AppHeaderComponent],
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
      user: { sub: '1', email: 'dev@sprintio.test', role: 'DEVELOPER', displayName: 'Dev Driver' },
    });
    fixture = TestBed.createComponent(AppHeaderComponent);
  });

  // Logging in opens the live stream and loads the bell; neither is what these tests are about.
  afterEach(() => {
    httpMock.match('/events/ticket').forEach((req) => req.flush({ ticket: 'stream-ticket' }));
    httpMock.match('/notifications').forEach((req) => req.flush({ unread: 0, items: [] }));
    httpMock.verify();
  });

  it('shows the initials of the signed-in user in the account button', () => {
    fixture.detectChanges();
    const avatar: HTMLElement = fixture.nativeElement.querySelector('button[aria-label="Cuenta"]');
    expect(avatar.textContent?.trim()).toBe('DD');
  });

  it('saves the display name trimmed', () => {
    fixture.componentInstance.saveProfile('  Rubén  ');
    const req = httpMock.expectOne('/auth/profile');
    expect(req.request.body).toEqual({ displayName: 'Rubén' });
    req.flush({ sub: '1', email: 'dev@sprintio.test', role: 'DEVELOPER', displayName: 'Rubén' });
  });

  it('lists recent boards on focus, then searches cards only from two characters on', fakeAsync(() => {
    fixture.detectChanges();
    fixture.componentInstance.openSearch();
    httpMock.expectOne('/boards').flush([{ id: 'b1', title: 'Monaco', ownerId: '1' }]);

    fixture.componentInstance.onInput('c');
    tick(300);
    httpMock.expectNone((req) => req.url === '/search');

    fixture.componentInstance.onInput('carburador');
    tick(300);
    const req = httpMock.expectOne((r) => r.url === '/search');
    expect(req.request.params.get('q')).toBe('carburador');
    req.flush([]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.empty-state')).not.toBeNull();
  }));

  it('logs out and returns to the login page', async () => {
    fixture.componentInstance.logout();
    httpMock.expectOne('/auth/logout').flush(null);

    await fixture.whenStable();
    expect(TestBed.inject(AuthService).isAuthenticated()).toBe(false);
    expect(TestBed.inject(Router).url).toBe('/login');
  });
});
