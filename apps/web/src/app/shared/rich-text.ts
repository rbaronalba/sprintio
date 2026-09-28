import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnInit,
  Pipe,
  PipeTransform,
  effect,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';

// Text is stored as plain Markdown-ish (**b** *i* ~~s~~ `code`, "- " and "1. " lists), so the
// API needs no schema change; it only ever sees a string.
// ponytail: five inline/list marks, no headings/links/nesting — swap in `marked` if more is needed.
const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const inline = (s: string) =>
  escapeHtml(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/~~(.+?)~~/g, '<s>$1</s>');

function renderRich(text: string): string {
  const out: string[] = [];
  let open = '';
  for (const line of text.split('\n')) {
    const m = /^(- |\d+\. )(.*)$/.exec(line);
    const tag = m ? (m[1] === '- ' ? 'ul' : 'ol') : '';
    if (tag !== open) {
      if (open) out.push(`</${open}>`);
      if (tag) out.push(`<${tag}>`);
      open = tag;
    }
    out.push(m ? `<li>${inline(m[2])}</li>` : line ? `<p>${inline(line)}</p>` : '');
  }
  if (open) out.push(`</${open}>`);
  return out.join('');
}

@Pipe({ name: 'rich' })
export class RichPipe implements PipeTransform {
  transform(text: string | null | undefined): string {
    return renderRich(text ?? '');
  }
}

// The editor is WYSIWYG (contenteditable); this turns its DOM back into the stored Markdown.
function toMarkdown(root: Node): string {
  const mark = (m: string, s: string) => (s.trim() ? m + s + m : s);
  const walk = (n: Node): string => {
    if (n.nodeType === Node.TEXT_NODE) return n.textContent ?? '';
    const el = n as HTMLElement;
    const kids = () => Array.from(el.childNodes).map(walk).join('');
    switch (el.tagName) {
      case 'B':
      case 'STRONG':
        return mark('**', kids());
      case 'I':
      case 'EM':
        return mark('*', kids());
      case 'S':
      case 'STRIKE':
      case 'DEL':
        return mark('~~', kids());
      case 'CODE':
        return mark('`', kids());
      case 'BR':
        return '\n';
      case 'DIV':
      case 'P':
        return '\n' + kids();
      case 'UL':
      case 'OL': {
        let i = 0;
        const bullet = () => (el.tagName === 'UL' ? '- ' : `${++i}. `);
        return '\n' + Array.from(el.children).map((li) => bullet() + walk(li)).join('\n') + '\n';
      }
      default:
        return kids();
    }
  };
  return walk(root).replace(/\n{3,}/g, '\n\n').trim();
}

/** Click-to-edit rich text, like the card title: shows the rendered text (or a hint) until clicked.
 *  `value` mirrors the current Markdown so callers can read/clear it via a template ref. */
@Component({
  selector: 'app-rich-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RichPipe],
  template: `
    @if (editing()) {
      <div class="rich">
        <div class="rich-bar" (mousedown)="$event.preventDefault()">
          <button type="button" title="Bold" aria-label="Bold" (click)="cmd('bold')"><b>B</b></button>
          <button type="button" title="Italic" aria-label="Italic" (click)="cmd('italic')"><i>I</i></button>
          <button type="button" title="Strikethrough" aria-label="Strikethrough" (click)="cmd('strikeThrough')"><s>S</s></button>
          <button type="button" title="Code" aria-label="Code" (click)="code()">&lt;&gt;</button>
          <span class="rich-sep"></span>
          <button type="button" title="Bulleted list" aria-label="Bulleted list" (click)="cmd('insertUnorderedList')">&#8226;</button>
          <button type="button" title="Numbered list" aria-label="Numbered list" (click)="cmd('insertOrderedList')">1.</button>
          <span class="rich-end"><ng-content /></span>
        </div>
        <div #ed class="rich-ed rich-out" contenteditable="true" [style.min-height.px]="rows() * 21" (blur)="stop()"></div>
      </div>
    } @else {
      <div class="rich-view" role="button" tabindex="0" (click)="start()" (keydown.enter)="start()">
        @if (text()) {
          <div class="rich-out" [innerHTML]="text() | rich"></div>
        } @else {
          <span class="rich-empty">{{ hint() }}</span>
        }
      </div>
    }
  `,
  styles: `
    .rich { border: 1px solid var(--hairline); border-radius: var(--radius-md); background: var(--input-bg); }
    .rich:focus-within { border-color: var(--ink); }
    .rich-bar { display: flex; align-items: center; gap: 2px; padding: 2px 4px; border-bottom: 1px solid var(--hairline); }
    .rich-bar button { min-width: 24px; height: 24px; padding: 0 4px; border: none; border-radius: var(--radius-sm); background: none; color: var(--body); font: inherit; font-size: 12px; cursor: pointer; }
    .rich-bar button:hover { background: var(--canvas-elevated); color: var(--ink); }
    .rich-sep { width: 1px; height: 14px; margin: 0 2px; background: var(--hairline); }
    .rich-end { margin-inline-start: auto; display: flex; }
    .rich-ed { padding: 6px 8px; outline: none; overflow-wrap: anywhere; }
    .rich-view { padding: 6px 8px; border-radius: var(--radius-md); cursor: pointer; overflow-wrap: anywhere; }
    .rich-view:hover { background: var(--canvas-elevated); }
    .rich-empty { color: var(--muted); }
  `,
})
export class RichEditorComponent implements OnInit {
  readonly initial = input('');
  readonly rows = input(3);
  readonly hint = input('');
  readonly text = signal('');
  readonly editing = signal(false);
  private readonly ed = viewChild<ElementRef<HTMLDivElement>>('ed');

  constructor() {
    // Runs when the editable div appears: fill it and put the caret at the end.
    effect(() => {
      const el = this.ed()?.nativeElement;
      if (!el) return;
      el.innerHTML = renderRich(untracked(this.text));
      el.focus();
      getSelection()?.selectAllChildren(el);
      getSelection()?.collapseToEnd();
    });
  }

  ngOnInit(): void {
    this.text.set(this.initial());
  }

  get value(): string {
    const el = this.ed()?.nativeElement;
    return el ? toMarkdown(el) : this.text();
  }
  set value(v: string) {
    this.text.set(v);
    this.editing.set(false);
  }

  start(): void {
    this.editing.set(true);
  }
  stop(): void {
    this.text.set(this.value);
    this.editing.set(false);
  }
  cmd(name: string): void {
    document.execCommand(name);
  }
  code(): void {
    const sel = getSelection()?.toString() ?? '';
    if (sel) document.execCommand('insertHTML', false, `<code>${escapeHtml(sel)}</code>`);
  }
}
