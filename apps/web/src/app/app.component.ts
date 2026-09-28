import { Component, ChangeDetectionStrategy, HostListener } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
    selector: 'app-root',
    imports: [RouterOutlet],
    templateUrl: './app.component.html',
    changeDetection: ChangeDetectionStrategy.Eager,
    styleUrl: './app.component.scss'
})
export class AppComponent {
  /** Outside clicks dismiss whatever is open: modal dialogs (backdrop) and <details> menus. */
  @HostListener('document:click', ['$event'])
  dismiss(event: MouseEvent): void {
    const target = event.target as Element;
    if (target instanceof HTMLDialogElement && target.open) {
      // The backdrop reports the dialog itself as the target, so tell it from a click on its padding by position.
      const r = target.getBoundingClientRect();
      const inside = event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom;
      if (!inside) target.close();
    }
    document.querySelectorAll('details.menu[open]').forEach((d) => {
      if (!d.contains(target)) d.removeAttribute('open');
    });
  }
}
