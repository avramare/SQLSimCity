import { DISTRICTS } from '../data/districts';
import type { Building, District } from '../types';

export interface Inspector {
  showDistrict(district: District): void;
  showBuilding(building: Building, district: District): void;
  close(): void;
  readonly isOpen: boolean;
  readonly currentBuildingId: string | null;
}

interface Handlers {
  onBuilding(id: string): void;
  onDistrict(id: string): void;
}

export function createInspector(handlers: Handlers): Inspector {
  const root = document.getElementById('inspector') as HTMLElement;
  const body = document.getElementById('inspectorBody') as HTMLElement;
  let open = false;
  let currentBuildingId: string | null = null;

  root.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const bId = target.closest<HTMLElement>('[data-building]')?.dataset.building;
    if (bId) {
      handlers.onBuilding(bId);
      return;
    }
    const dId = target.closest<HTMLElement>('[data-district]')?.dataset.district;
    if (dId) handlers.onDistrict(dId);
  });

  function show(html: string, color: number): void {
    body.innerHTML = html;
    body.scrollTop = 0;
    body.style.setProperty('--kicker', '#' + color.toString(16).padStart(6, '0'));
    root.classList.add('is-open');
    open = true;
  }

  return {
    get isOpen() {
      return open;
    },
    get currentBuildingId() {
      return currentBuildingId;
    },

    showDistrict(district) {
      currentBuildingId = null;
      const neighbours = DISTRICTS.filter((d) => d.id !== district.id);
      show(
        `
        <div class="insp-kicker">district ${district.hotkey} · ${esc(district.subtitle)}</div>
        <h2 class="insp-title">${esc(district.name)}</h2>
        <p class="insp-mech">${esc(district.mechanism)}</p>
        <p class="insp-summary">${esc(district.blurb)}</p>
        <h3 class="insp-h">How it really works</h3>
        <ul class="insp-list">${district.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>
        <h3 class="insp-h">Buildings — click to inspect</h3>
        <div class="insp-buildings">
          ${district.buildings
            .map(
              (b) =>
                `<button class="insp-bcard" data-building="${b.id}"><b>${esc(b.name)}</b><span>${esc(
                  b.role,
                )}</span></button>`,
            )
            .join('')}
        </div>
        <h3 class="insp-h">Jump to</h3>
        <div class="insp-buildings">
          ${neighbours
            .map(
              (d) =>
                `<button class="insp-bcard" data-district="${d.id}"><b>${esc(d.name)}</b><span>press ${
                  d.hotkey
                }</span></button>`,
            )
            .join('')}
        </div>
        `,
        district.color,
      );
    },

    showBuilding(building, district) {
      currentBuildingId = building.id;
      const siblings = district.buildings.filter((b) => b.id !== building.id);
      show(
        `
        <div class="insp-kicker">${esc(district.name)} · press ${district.hotkey}</div>
        <h2 class="insp-title">${esc(building.name)}</h2>
        <p class="insp-role">${esc(building.role)}</p>
        <p class="insp-summary">${esc(building.summary)}</p>
        <h3 class="insp-h">Details</h3>
        <ul class="insp-list">${building.details.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>
        ${
          building.vars?.length
            ? `<h3 class="insp-h">System variables</h3>
               <div class="insp-vars">${building.vars
                 .map(([name, note]) => `<div class="insp-var"><code>${esc(name)}</code><span>${esc(note)}</span></div>`)
                 .join('')}</div>`
            : ''
        }
        ${
          building.observe
            ? `<h3 class="insp-h">See it on a real server</h3><pre class="insp-sql">${esc(building.observe)}</pre>`
            : ''
        }
        <h3 class="insp-h">Nearby in ${esc(district.name)}</h3>
        <div class="insp-buildings">
          ${siblings
            .map(
              (b) =>
                `<button class="insp-bcard" data-building="${b.id}"><b>${esc(b.name)}</b><span>${esc(
                  b.role,
                )}</span></button>`,
            )
            .join('')}
        </div>
        <div class="insp-nav">
          <button class="btn btn-small" data-district="${district.id}">← Back to ${esc(district.name)}</button>
        </div>
        `,
        district.color,
      );
    },

    close() {
      root.classList.remove('is-open');
      open = false;
      currentBuildingId = null;
    },
  };
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
