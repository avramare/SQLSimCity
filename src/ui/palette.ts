export interface PaletteCommand {
  id: string;
  name: string;
  sub: string;
  /** Short glyph shown in the coloured chip. */
  glyph: string;
  color: string;
  hint?: string;
  keywords?: string;
  run(): void;
}

export interface Palette {
  open(): void;
  close(): void;
  toggle(): void;
  readonly isOpen: boolean;
}

export function createPalette(getCommands: () => PaletteCommand[]): Palette {
  const root = document.getElementById('palette') as HTMLElement;
  const input = document.getElementById('paletteInput') as HTMLInputElement;
  const list = document.getElementById('paletteList') as HTMLUListElement;

  let results: PaletteCommand[] = [];
  let active = 0;
  let open = false;

  function render(): void {
    const q = input.value.trim();
    results = rank(getCommands(), q).slice(0, 40);
    active = 0;
    if (results.length === 0) {
      list.innerHTML = `<li class="palette-empty">Nothing matches “${escapeHtml(q)}”.</li>`;
      return;
    }
    list.innerHTML = results
      .map(
        (c, i) => `
        <li class="palette-item${i === 0 ? ' is-active' : ''}" data-index="${i}">
          <span class="palette-icon" style="background:${c.color}">${escapeHtml(c.glyph)}</span>
          <span class="palette-text">
            <span class="palette-name">${escapeHtml(c.name)}</span>
            <span class="palette-sub">${escapeHtml(c.sub)}</span>
          </span>
          ${c.hint ? `<span class="palette-hint">${escapeHtml(c.hint)}</span>` : ''}
        </li>`,
      )
      .join('');
  }

  function setActive(i: number): void {
    if (results.length === 0) return;
    active = (i + results.length) % results.length;
    list.querySelectorAll('.palette-item').forEach((el, idx) => {
      el.classList.toggle('is-active', idx === active);
      if (idx === active) el.scrollIntoView({ block: 'nearest' });
    });
  }

  function runActive(): void {
    const cmd = results[active];
    if (!cmd) return;
    close();
    cmd.run();
  }

  function openPalette(): void {
    root.hidden = false;
    open = true;
    input.value = '';
    render();
    input.focus();
  }

  function close(): void {
    root.hidden = true;
    open = false;
    input.blur();
  }

  input.addEventListener('input', render);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(active + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(active - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runActive();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
    e.stopPropagation();
  });

  list.addEventListener('mousemove', (e) => {
    const idx = (e.target as HTMLElement).closest<HTMLElement>('.palette-item')?.dataset.index;
    if (idx !== undefined) setActive(Number(idx));
  });

  list.addEventListener('click', (e) => {
    const idx = (e.target as HTMLElement).closest<HTMLElement>('.palette-item')?.dataset.index;
    if (idx !== undefined) {
      active = Number(idx);
      runActive();
    }
  });

  root.addEventListener('mousedown', (e) => {
    if (e.target === root) close();
  });

  return {
    get isOpen() {
      return open;
    },
    open: openPalette,
    close,
    toggle() {
      if (open) close();
      else openPalette();
    },
  };
}

/** Subsequence scoring: exact substrings win, then in-order character matches. */
function rank(commands: PaletteCommand[], query: string): PaletteCommand[] {
  if (!query) return commands;
  const q = query.toLowerCase();
  const scored: Array<{ cmd: PaletteCommand; score: number }> = [];

  for (const cmd of commands) {
    const haystack = `${cmd.name} ${cmd.sub} ${cmd.keywords ?? ''}`.toLowerCase();
    const nameIdx = cmd.name.toLowerCase().indexOf(q);
    let score = -1;

    if (nameIdx === 0) score = 1000;
    else if (nameIdx > 0) score = 700 - nameIdx;
    else if (haystack.includes(q)) score = 400 - haystack.indexOf(q) * 0.5;
    else {
      // fuzzy: every query char must appear in order
      let i = 0;
      let gaps = 0;
      for (const ch of q) {
        const found = haystack.indexOf(ch, i);
        if (found === -1) {
          i = -1;
          break;
        }
        gaps += found - i;
        i = found + 1;
      }
      if (i !== -1) score = 200 - gaps * 0.4;
    }

    if (score > 0) scored.push({ cmd, score });
  }

  return scored.sort((a, b) => b.score - a.score).map((s) => s.cmd);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
