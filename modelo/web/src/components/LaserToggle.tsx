import { useLaser } from "../laser.ts";

/** Botão do cabeçalho que liga e desliga o ponteiro laser em todo o portal. Some em telas de toque, onde não há ponteiro. */
export function LaserToggle() {
  const [on, setOn] = useLaser();
  return (
    <button
      type="button"
      className={`laser-toggle${on ? " on" : ""}`}
      aria-pressed={on}
      title={on ? "Desligar o ponteiro laser" : "Ligar o ponteiro laser: o mouse vira um ponto vermelho em todo o painel, para apresentar"}
      onClick={() => setOn(!on)}
    >
      <span className="laser-dot" aria-hidden="true" />
      {on ? "Laser ligado" : "Laser"}
    </button>
  );
}
