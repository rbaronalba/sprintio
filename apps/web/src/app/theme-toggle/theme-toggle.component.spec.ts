import { TestBed } from '@angular/core/testing';
import { ThemeToggleComponent } from './theme-toggle.component';

describe('ThemeToggleComponent', () => {
  beforeEach(() => localStorage.removeItem('sprintio-theme'));
  afterEach(() => localStorage.removeItem('sprintio-theme'));

  it('switches between dark and light and remembers the choice', () => {
    const fixture = TestBed.createComponent(ThemeToggleComponent);
    fixture.detectChanges();

    const button: HTMLButtonElement = fixture.nativeElement.querySelector('button');
    expect(button.getAttribute('aria-label')).toBe('Switch to light theme');

    button.click();
    fixture.detectChanges();

    expect(button.getAttribute('aria-label')).toBe('Switch to dark theme');
    expect(document.documentElement.dataset['theme']).toBe('light');
    expect(localStorage.getItem('sprintio-theme')).toBe('light');
  });
});
