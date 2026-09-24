import { DISTRICTS } from '../data/districts';
import { WORKLOAD_NAMES, formatNumber } from '../sim';
import type { Sim } from '../sim';
import type { LabelMode } from '../scene/city';

export interface HudHandlers {
  onDistrict(id: string): void;
  onShadows(on: boolean): void;
  onLabelCycle(): void;
  onPauseToggle(): void;
}

export interface Hud {
  update(sim: Sim): void;
  setActiveDistrict(id: string | null): void;
  setLabelMode(mode: LabelMode): void;
  setPaused(paused: boolean): void;
  syncControls(sim: Sim): void;
  fadeHint(): void;
}

export function createHud(handlers: HudHandlers): Hud {
  const bar = document.getElementById('districtBar') as HTMLElement;
  const hint = document.getElementById('hint') as HTMLElement;

  bar.innerHTML = DISTRICTS.map(
    (d) => `
      <button class="chip" data-district="${d.id}" style="--chip:#${d.color
        .toString(16)
        .padStart(6, '0')}">
        <span class="chip-key">${d.hotkey}</span>
        <span class="chip-text">
          <span class="chip-name">${d.name}</span>
          <span class="chip-sub">${d.subtitle}</span>
        </span>
      </button>`,
  ).join('');

  bar.addEventListener('click', (e) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-district]')?.dataset.district;
    if (id) handlers.onDistrict(id);
  });

  const values = new Map<string, HTMLElement>();
  const metrics = new Map<string, HTMLElement>();
  document.querySelectorAll<HTMLElement>('.metric').forEach((el) => {
    const key = el.dataset.metric!;
    metrics.set(key, el);
    values.set(key, el.querySelector('.metric-value') as HTMLElement);
  });

  const shadows = document.getElementById('shadows') as HTMLInputElement;
  shadows.addEventListener('change', () => handlers.onShadows(shadows.checked));

  const labelsBtn = document.querySelector<HTMLElement>('[data-action="labels"]')!;
  labelsBtn.addEventListener('click', () => handlers.onLabelCycle());

  const pauseBtn = document.querySelector<HTMLElement>('[data-action="pause"]')!;
  pauseBtn.addEventListener('click', () => handlers.onPauseToggle());

  const controlRoom = document.getElementById('controlroom') as HTMLElement;
  document
    .querySelector<HTMLElement>('[data-action="toggle-controlroom"]')!
    .addEventListener('click', (e) => {
      controlRoom.classList.toggle('is-collapsed');
      (e.currentTarget as HTMLElement).textContent = controlRoom.classList.contains('is-collapsed')
        ? '+'
        : '–';
    });

  const workloadValue = document.getElementById('workloadValue') as HTMLElement;
  let hintFaded = false;

  function tone(el: HTMLElement | undefined, level: 'ok' | 'warn' | 'bad' | 'none'): void {
    if (!el) return;
    el.classList.toggle('is-good', level === 'ok');
    el.classList.toggle('is-warn', level === 'warn');
    el.classList.toggle('is-bad', level === 'bad');
  }

  return {
    update(sim) {
      const s = sim.state;
      values.get('qps')!.textContent = formatNumber(s.qps);
      values.get('dirty')!.textContent = s.dirtyPct.toFixed(1);
      values.get('redo')!.textContent = s.redoUsedPct.toFixed(1);
      values.get('hit')!.textContent = s.hitRate.toFixed(2);
      values.get('history')!.textContent = formatNumber(s.historyLen);
      values.get('fsync')!.textContent = formatNumber(s.fsyncPerSec);
      values.get('lag')!.textContent = formatNumber(s.replicaLagMs);

      tone(metrics.get('dirty'), s.dirtyPct > 85 ? 'bad' : s.dirtyPct > 60 ? 'warn' : 'none');
      tone(metrics.get('redo'), s.redoUsedPct > 75 ? 'bad' : s.redoUsedPct > 45 ? 'warn' : 'none');
      tone(metrics.get('hit'), s.hitRate > 99 ? 'ok' : s.hitRate > 97 ? 'none' : 'warn');
      tone(
        metrics.get('history'),
        s.historyLen > 40000 ? 'bad' : s.historyLen > 8000 ? 'warn' : 'none',
      );
      tone(metrics.get('lag'), s.replicaLagMs > 400 ? 'bad' : s.replicaLagMs > 150 ? 'warn' : 'none');

      workloadValue.textContent = WORKLOAD_NAMES[sim.config.workload];
    },

    setActiveDistrict(id) {
      bar.querySelectorAll<HTMLElement>('.chip').forEach((el) => {
        el.classList.toggle('is-active', el.dataset.district === id);
      });
    },

    setLabelMode(mode) {
      labelsBtn.textContent = `Labels: ${mode}`;
    },

    setPaused(paused) {
      pauseBtn.textContent = paused ? '▶ Resume' : '⏸ Pause';
      pauseBtn.classList.toggle('is-active', paused);
    },

    syncControls(sim) {
      (document.getElementById('workload') as HTMLInputElement).value = String(sim.config.workload);
      (document.getElementById('flushLog') as HTMLSelectElement).value = String(
        sim.config.flushLogAtTrxCommit,
      );
      (document.getElementById('syncBinlog') as HTMLSelectElement).value = String(sim.config.syncBinlog);
      (document.getElementById('adaptiveFlush') as HTMLInputElement).checked =
        sim.config.adaptiveFlushing;
      (document.getElementById('longTrx') as HTMLInputElement).checked = sim.longTransaction;
      workloadValue.textContent = WORKLOAD_NAMES[sim.config.workload];
    },

    fadeHint() {
      if (hintFaded) return;
      hintFaded = true;
      window.setTimeout(() => hint.classList.add('is-hidden'), 6000);
    },
  };
}
