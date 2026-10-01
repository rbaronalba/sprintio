import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
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
    httpMock.expectOne('/workspaces').flush([]);
    fixture.detectChanges();
    const user: HTMLElement = fixture.nativeElement.querySelector('[data-testid="current-user"]');
    expect(user.textContent).toBe('dev@sprintio.test');
  });

  const board = (id: string, ownerId: string, workspaceId: string, lastViewedAt: string | null = null) =>
    ({ id, title: `Board ${id}`, ownerId, workspaceId, lastViewedAt });

  it('groups boards by workspace and only offers deleting boards the user owns', () => {
    fixture.componentInstance.view.set('boards');
    httpMock.expectOne('/boards').flush([board('mine', '1', 'w1'), board('shared', '9', 'w2')]);
    httpMock.expectOne('/workspaces').flush([
      { id: 'w1', name: 'Software', ownerId: '1', isMember: true, inviteToken: null },
      { id: 'w2', name: 'Admin', ownerId: '9', isMember: false, inviteToken: null },
    ]);
    fixture.detectChanges();

    const groups: HTMLElement[] = Array.from(fixture.nativeElement.querySelectorAll('section.group'));
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual(['Software', 'Admin']);
    expect(groups[0].querySelector('button[aria-label="Eliminar tablero"]')).not.toBeNull();
    expect(groups[1].querySelector('button[aria-label="Eliminar tablero"]')).toBeNull();
    // Only workspace members add boards; w2 is only visible through a directly shared board.
    expect(groups[0].querySelector('.board-tile--new')).not.toBeNull();
    expect(groups[1].querySelector('.board-tile--new')).toBeNull();
  });

  it('lists the three most recently viewed boards, newest first', () => {
    httpMock.expectOne('/boards').flush([
      board('a', '1', 'w1', '2026-09-01T00:00:00Z'),
      board('b', '1', 'w1', '2026-09-04T00:00:00Z'),
      board('never', '1', 'w1'),
      board('c', '1', 'w1', '2026-09-03T00:00:00Z'),
      board('d', '1', 'w1', '2026-09-02T00:00:00Z'),
    ]);
    httpMock.expectOne('/workspaces').flush([{ id: 'w1', name: 'Software', ownerId: '1', isMember: true, inviteToken: null }]);
    expect(fixture.componentInstance.recent().map((b) => b.id)).toEqual(['b', 'c', 'd']);
  });

  it('shows starred boards on Home', () => {
    httpMock.expectOne('/boards').flush([
      { ...board('fav', '1', 'w1'), starred: true },
      { ...board('plain', '1', 'w1'), starred: false },
    ]);
    httpMock.expectOne('/workspaces').flush([{ id: 'w1', name: 'Software', ownerId: '1', isMember: true, inviteToken: null }]);
    fixture.detectChanges();
    const starred: HTMLElement = fixture.nativeElement.querySelector('section.starred');
    expect(starred.textContent).toContain('Board fav');
    expect(starred.textContent).not.toContain('Board plain');
  });
});
