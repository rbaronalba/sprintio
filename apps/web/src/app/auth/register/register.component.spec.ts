import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { RegisterComponent } from './register.component';

@Component({ template: '' })
class BlankComponent {}

describe('RegisterComponent', () => {
  let fixture: ComponentFixture<RegisterComponent>;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [RegisterComponent],
      providers: [
        provideRouter([{ path: '**', component: BlankComponent }]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(RegisterComponent);
    fixture.componentInstance.form.setValue({
      email: 'dev@sprintio.test',
      password: 'password123',
    });
  });

  afterEach(() => httpMock.verify());

  it('navigates to the dashboard after signing up', async () => {
    fixture.componentInstance.submit();
    httpMock.expectOne('/auth/register').flush({
      accessToken: 'token-1',
      user: { sub: '1', email: 'dev@sprintio.test', role: 'DEVELOPER' },
    });

    await fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/dashboard');
  });

  it('tells the user when the email is already registered', async () => {
    fixture.componentInstance.submit();
    httpMock.expectOne('/auth/register').flush(null, { status: 409, statusText: 'Conflict' });

    fixture.detectChanges();
    const alert: HTMLElement = fixture.nativeElement.querySelector('[role="alert"]');
    expect(alert.textContent).toContain('That email is already registered');
  });
});
