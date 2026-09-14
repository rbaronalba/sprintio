import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from './auth.service';

describe('authInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let auth: AuthService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
  });

  afterEach(() => httpMock.verify());

  function login(accessToken: string): void {
    auth.login('dev@sprintio.test', 'password123').subscribe();
    httpMock
      .expectOne('/auth/login')
      .flush({ accessToken, user: { sub: '1', email: 'dev@sprintio.test', role: 'DEVELOPER' } });
  }

  it('attaches the access token to outgoing requests', () => {
    login('token-1');

    http.get('/boards').subscribe();

    const req = httpMock.expectOne('/boards');
    expect(req.request.headers.get('Authorization')).toBe('Bearer token-1');
    req.flush([]);
  });

  it('does not attach a token to login, register or refresh calls', () => {
    login('token-1');

    auth.refresh().subscribe();

    const req = httpMock.expectOne('/auth/refresh');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({
      accessToken: 'token-2',
      user: { sub: '1', email: 'dev@sprintio.test', role: 'DEVELOPER' },
    });
  });

  it('refreshes and retries the request once on a 401', () => {
    login('expired-token');

    let body: unknown;
    http.get('/boards').subscribe((res) => (body = res));

    httpMock.expectOne('/boards').flush(null, { status: 401, statusText: 'Unauthorized' });

    httpMock.expectOne('/auth/refresh').flush({
      accessToken: 'fresh-token',
      user: { sub: '1', email: 'dev@sprintio.test', role: 'DEVELOPER' },
    });

    const retried = httpMock.expectOne('/boards');
    expect(retried.request.headers.get('Authorization')).toBe('Bearer fresh-token');
    retried.flush([{ id: 'b1' }]);

    expect(body).toEqual([{ id: 'b1' }]);
  });

  it('refreshes only once when several requests fail with 401 at the same time', () => {
    login('expired-token');

    http.get('/boards').subscribe();
    http.get('/cards').subscribe();

    httpMock.expectOne('/boards').flush(null, { status: 401, statusText: 'Unauthorized' });
    httpMock.expectOne('/cards').flush(null, { status: 401, statusText: 'Unauthorized' });

    // A single shared refresh serves both failed requests.
    const refreshCalls = httpMock.match('/auth/refresh');
    expect(refreshCalls.length).toBe(1);
    refreshCalls[0].flush({
      accessToken: 'fresh-token',
      user: { sub: '1', email: 'dev@sprintio.test', role: 'DEVELOPER' },
    });

    httpMock.expectOne('/boards').flush([]);
    httpMock.expectOne('/cards').flush([]);
  });

  it('clears the session when the refresh itself fails', () => {
    login('expired-token');

    http.get('/boards').subscribe({ error: () => undefined });

    httpMock.expectOne('/boards').flush(null, { status: 401, statusText: 'Unauthorized' });
    httpMock
      .expectOne('/auth/refresh')
      .flush(null, { status: 401, statusText: 'Unauthorized' });

    expect(auth.isAuthenticated()).toBe(false);
    expect(auth.accessToken).toBeNull();
  });
});
