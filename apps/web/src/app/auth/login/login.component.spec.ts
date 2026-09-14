import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { LoginComponent } from './login.component';

@Component({ template: '' })
class BlankComponent {}

describe('LoginComponent', () => {
  let fixture: ComponentFixture<LoginComponent>;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        provideRouter([{ path: '**', component: BlankComponent }]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(LoginComponent);
    fixture.componentInstance.form.setValue({
      email: 'dev@sprintio.test',
      password: 'password123',
    });
  });

  afterEach(() => httpMock.verify());

  it('navigates to the dashboard after a successful login', async () => {
    fixture.componentInstance.submit();
    httpMock.expectOne('/auth/login').flush({
      accessToken: 'token-1',
      user: { sub: '1', email: 'dev@sprintio.test', role: 'DEVELOPER' },
    });

    await fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/dashboard');
  });

  it('shows an error when the credentials are rejected', async () => {
    fixture.componentInstance.submit();
    httpMock.expectOne('/auth/login').flush(null, { status: 401, statusText: 'Unauthorized' });

    fixture.detectChanges();
    const alert: HTMLElement = fixture.nativeElement.querySelector('[role="alert"]');
    expect(alert.textContent).toContain('Invalid email or password');
  });
});
