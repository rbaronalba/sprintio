import { Directive, ElementRef, afterNextRender, inject } from '@angular/core';

/**
 * Focuses the element once it is on screen. For inline editors the user just opened by
 * clicking, where moving focus into the field is the expected behaviour.
 */
@Directive({ selector: '[appAutofocus]' })
export class AutofocusDirective {
  constructor() {
    const element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    afterNextRender(() => element.focus());
  }
}
