// O painel: um cartão para cada dashboard que a pessoa pode ver. Mesmo com um só.
import { dateTime } from "../../../shared/format.ts";
import { go, usePanel } from "../hooks.ts";
import { PROJECT_NAME } from "../project.ts";

type Card = {
  slug: string;
  name: string;
  question: string;
  source: string;
  updatedAt: string | null;
  /** Falso quando o banco do dashboard não respondeu: o cartão diz isso, em vez de mostrar uma data que não existe. */
  available: boolean;
  /** Foto real da tela, tirada depois da última carga. Sem navegador na máquina, não há. */
  thumbnail: string | null;
};

function CardView({ card }: { card: Card }) {
  return (
    <a
      className="card"
      href={`/d/${card.slug}`}
      onClick={(event) => {
        // Clique com o botão do meio, ou com Ctrl, abre em outra aba como um link comum.
        if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;
        event.preventDefault();
        go(`/d/${card.slug}`);
      }}
    >
      {card.thumbnail
        ? <img className="card-thumb" src={card.thumbnail} alt={`Tela do dashboard ${card.name}`} loading="lazy" />
        : <span className="card-thumb card-thumb-empty" role="img" aria-label="Sem imagem da tela">Sem imagem</span>}
      <span className="card-body">
        <strong className="card-name">{card.name}</strong>
        <span className="card-question">{card.question}</span>
        <small>Fonte: {card.source}</small>
        <small>{card.available ? `Última atualização: ${dateTime(card.updatedAt)}` : "Não foi possível ler a data da última atualização."}</small>
      </span>
    </a>
  );
}

type Section = { id: string | null; name: string; slugs: string[]; title: boolean };

export function Portal() {
  const { state, retry } = usePanel<{ dashboards: Card[]; sections: Section[] }>("/api/dashboards", "");

  return (
    <main className="page">
      <h2 className="portal-title">{PROJECT_NAME}</h2>
      {state.status === "loading" && !state.data && <p className="state" role="status">Carregando...</p>}
      {state.status === "error" && (
        <section className="block state error" role="alert">
          <span>Não foi possível carregar os dashboards. {state.message}</span>
          <button type="button" onClick={retry}>Tentar de novo</button>
        </section>
      )}
      {state.status !== "error" && state.data && (state.data.dashboards.length === 0
        ? (
          <section className="block state" role="status">
            <span>Você ainda não tem acesso a nenhum dashboard. Fale com quem administra o {PROJECT_NAME.toLowerCase()}.</span>
          </section>
        )
        : state.data.sections.map((section) => (
          <section key={section.id ?? "sem-categoria"} className="category-section" aria-label={section.title ? `Categoria ${section.name}` : "Dashboards"}>
            {/* O título só aparece com mais de uma categoria à vista. Com uma só, o painel é o de sempre. */}
            {section.title && <h3 className="category-title">{section.name}</h3>}
            <div className="cards">
              {section.slugs.map((slug) => state.data!.dashboards.find((card) => card.slug === slug)).flatMap((card) => (card ? [<CardView key={card.slug} card={card} />] : []))}
            </div>
          </section>
        )))}
    </main>
  );
}
