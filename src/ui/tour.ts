import { TOUR } from '../data/tour';
import type { TourStep } from '../types';

export interface TourUI {
  start(index?: number): void;
  stop(): void;
  next(): void;
  prev(): void;
  toggle(): void;
  readonly isActive: boolean;
  readonly index: number;
}

export function createTour(onStep: (step: TourStep, index: number) => void): TourUI {
  const root = document.getElementById('tour') as HTMLElement;
  const stepEl = document.getElementById('tourStep') as HTMLElement;
  const titleEl = document.getElementById('tourTitle') as HTMLElement;
  const bodyEl = document.getElementById('tourBody') as HTMLElement;
  const dotsEl = document.getElementById('tourDots') as HTMLElement;

  let index = 0;
  let active = false;

  dotsEl.innerHTML = TOUR.map(
    (s, i) => `<button class="tour-dot" data-index="${i}" title="${s.title}"></button>`,
  ).join('');

  dotsEl.addEventListener('click', (e) => {
    const idx = (e.target as HTMLElement).dataset.index;
    if (idx !== undefined) goto(Number(idx));
  });

  function paint(): void {
    const step = TOUR[index];
    stepEl.textContent = `${index + 1} / ${TOUR.length}`;
    titleEl.textContent = step.title;
    bodyEl.textContent = step.body;
    dotsEl.querySelectorAll('.tour-dot').forEach((el, i) => {
      el.classList.toggle('is-active', i === index);
    });
  }

  function goto(i: number): void {
    if (i < 0 || i >= TOUR.length) {
      stop();
      return;
    }
    index = i;
    paint();
    onStep(TOUR[index], index);
  }

  function start(i = 0): void {
    active = true;
    root.hidden = false;
    goto(i);
  }

  function stop(): void {
    active = false;
    root.hidden = true;
  }

  return {
    start,
    stop,
    next: () => goto(index + 1),
    prev: () => goto(index - 1),
    toggle: () => (active ? stop() : start(0)),
    get isActive() {
      return active;
    },
    get index() {
      return index;
    },
  };
}
