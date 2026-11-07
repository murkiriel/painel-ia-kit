// O clique não desloca o que está sob o mouse. Filtrar muda a altura de outros blocos: legenda que some, aviso que aparece,
// cartão que cresce. Sem isto, o segundo clique no mesmo lugar acerta outro item, em vez de retirar a seleção.
// Em vez de prever cada causa, mede o item clicado a cada quadro, antes de pintar, e compensa a diferença.

// Depois disto sem clique novo, para de medir. O espaço reservado continua até a pessoa rolar.
const WATCH_MS = 20_000;

/**
 * Item que saiu do lugar por "moved" pixels (para baixo é positivo): quanto rolar e quanto espaço reservar acima dele.
 * O espaço reservado só entra quando não há mais para onde rolar, no topo da página.
 */
export function anchorStep(moved: number, scrollY: number, room: number): { scrollY: number; room: number } {
  if (moved > 0) {
    const fromRoom = Math.min(moved, room);
    return { scrollY: scrollY + moved - fromRoom, room: room - fromRoom };
  }
  const fromScroll = Math.min(-moved, scrollY);
  return { scrollY: scrollY - fromScroll, room: room - moved - fromScroll };
}

let page: HTMLElement | null = null;
let item: Element | null = null;
let block: Element | null = null;
let itemTop = 0;
let blockTop = 0;
let expectedY = 0;
let room = 0;
let watchUntil = 0;
let frame = 0;
let listening = false;

const setRoom = (value: number) => {
  room = value;
  page?.style.setProperty("--click-room", `${value}px`);
};

/** A pessoa rolou: devolve o espaço reservado sem mexer no que está à vista, e a página volta à altura real. */
function release() {
  cancelAnimationFrame(frame);
  frame = 0;
  item = null;
  block = null;
  if (page) page.style.minHeight = "";
  if (room > 0) {
    const y = window.scrollY;
    const extra = room;
    setRoom(0);
    window.scrollTo(window.scrollX, Math.max(0, y - extra));
  }
  window.removeEventListener("scroll", onScroll);
  listening = false;
}

function onScroll() {
  if (Math.abs(window.scrollY - expectedY) >= 1) release();
}

function watch() {
  frame = 0;
  if (Math.abs(window.scrollY - expectedY) >= 1) return release();
  // O item pode ter saído da tela, como uma linha da tabela: aí vale o bloco.
  const moved = item?.isConnected ? item.getBoundingClientRect().top - itemTop : block?.isConnected ? block.getBoundingClientRect().top - blockTop : 0;
  if (Math.abs(moved) >= 0.5) {
    const next = anchorStep(moved, window.scrollY, room);
    setRoom(next.room);
    window.scrollTo(window.scrollX, next.scrollY);
    expectedY = window.scrollY;
  }
  if (performance.now() < watchUntil) frame = requestAnimationFrame(watch);
}

/** Chamada antes de o clique chegar ao item. Só vale dentro dos blocos: a linha de filtros fica presa no topo e não se desloca. */
export function holdClickedPlace(container: HTMLElement, target: Element) {
  const clickedBlock = target.closest(".block");
  if (!clickedBlock) return;
  page = container;
  // O rótulo do mapa pode mudar de lugar com a seleção. O que precisa ficar parado é o mapa.
  item = target.closest(".map-box") ?? target;
  block = clickedBlock;
  itemTop = item.getBoundingClientRect().top;
  blockTop = block.getBoundingClientRect().top;
  expectedY = window.scrollY;
  watchUntil = performance.now() + WATCH_MS;
  // A página não encolhe até a pessoa rolar: no fim dela, o navegador puxaria tudo para baixo.
  container.style.minHeight = `${container.getBoundingClientRect().height}px`;
  if (!listening) {
    window.addEventListener("scroll", onScroll, { passive: true });
    listening = true;
  }
  if (!frame) frame = requestAnimationFrame(watch);
}
