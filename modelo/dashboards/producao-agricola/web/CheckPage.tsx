import { decimal, money, quantity } from "../../../shared/format.ts";
import { Block } from "../../../web/src/components/Block.tsx";
import { usePanel } from "../../../web/src/hooks.ts";
import { HELP } from "./indicators.ts";
import type { CheckRow, Meta } from "./types.ts";

const FORMATS = { money: (v: string | null) => money(v), area: (v: string | null) => quantity(v, "ha"), count: (v: string | null) => decimal(v) };
const format = (row: CheckRow, value: string | null) => FORMATS[row.kind](value);

/** Conferência à vista: a soma do dashboard contra o total publicado pela fonte. */
export function CheckPage() {
  const check = usePanel<Meta & { rows: CheckRow[] }>("check", "");

  return (
    <main className="page">
      <Block
        title="Conferência com a fonte"
        help={HELP.check}
        state={check.state}
        retry={check.retry}
        isEmpty={(d) => d.rows.length === 0}
        children={(d) => {
          const diverging = d.rows.filter((r) => r.status === "DIVERGE").length;
          return (
            <>
              <p>
                <strong className={diverging === 0 ? "status-ok" : "status-diverge"}>{decimal(diverging)} divergências</strong>{" "}
                em {decimal(d.rows.length)} conferências.
              </p>
              <div className="table-scroll">
                <table className="check">
                  <thead>
                    <tr>
                      <th>Indicador</th><th>Ano</th><th className="number">Fonte</th><th className="number">Dashboard</th>
                      <th className="number">Diferença</th><th className="number">Tolerância</th><th>Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.rows.map((r) => (
                      <tr key={`${r.indicator}-${r.year}`}>
                        <td>{r.indicator}</td>
                        <td>{r.year}</td>
                        <td className="number">{format(r, r.source)}</td>
                        <td className="number">{format(r, r.dashboard)}</td>
                        <td className="number">{format(r, r.difference)}</td>
                        <td className="number">{format(r, r.tolerance)}</td>
                        <td className={r.status === "OK" ? "status-ok" : "status-diverge"}>{r.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          );
        }}
      />
    </main>
  );
}
