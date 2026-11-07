import { useEffect, useState } from "react";

/**
 * Ponteiro laser: quem apresenta liga e o mouse vira um ponto vermelho em todo o portal (início, dashboards e apresentações).
 * A escolha é só deste navegador (localStorage) e continua ligada ao trocar de página. Sem o localStorage (janela privada,
 * dados bloqueados), funciona só enquanto a página estiver aberta.
 */
const KEY = "painel.laser";
const EVENT = "painel-laser";

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

let on = typeof window !== "undefined" && read();

function apply() {
  document.documentElement.classList.toggle("laser", on);
}

export function setLaser(next: boolean) {
  on = next;
  try {
    if (next) window.localStorage.setItem(KEY, "1");
    else window.localStorage.removeItem(KEY);
  } catch {
    /* sem armazenamento: vale até fechar a página */
  }
  apply();
  window.dispatchEvent(new Event(EVENT));
}

/** Liga o estado salvo assim que o portal abre, antes de qualquer tela. */
export function initLaser() {
  apply();
  // Outra aba mudou a escolha.
  window.addEventListener("storage", (event) => {
    if (event.key !== KEY) return;
    on = event.newValue === "1";
    apply();
    window.dispatchEvent(new Event(EVENT));
  });
}

export function useLaser(): [boolean, (next: boolean) => void] {
  const [value, setValue] = useState(on);
  useEffect(() => {
    const sync = () => setValue(on);
    window.addEventListener(EVENT, sync);
    sync();
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  return [value, setLaser];
}
