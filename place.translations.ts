/**
 * place.translations.ts -- per-language display text for this instance.
 *
 * Kept beside `place.config.ts`, not inside it: the PlaceConfig declaration is a
 * flat schema that `npm run init` re-emits for every adopter and
 * `npm run place-config:check` gates, and a language-keyed map does not fit it.
 * Each entry is a partial overlay over the base (default-language) values in
 * `place.config.ts`; anything absent falls back to them. Only translatable text
 * lives here -- slugs, hrefs, icons, tones and the `categories[].title` used as
 * the knowledge/ folder name stay in `place.config.ts` (folder identity never
 * localizes). Read through `src/lib/place-i18n.ts`.
 */
import type { PlaceConfig } from './place.config';

/** Recursive partial; arrays merge index-wise (see src/lib/place-i18n.ts). */
export type DeepPartial<T> = T extends Array<infer U>
  ? Array<DeepPartial<U>>
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

export interface PlaceTranslation {
  tagline?: string;
  /** Keyed by category slug. */
  categories?: Record<string, { title?: string; description?: string }>;
  home?: DeepPartial<PlaceConfig['home']>;
}

const translations: Record<string, PlaceTranslation> = {
  it: {
    tagline: 'Base di conoscenza open source, a misura di IA, su Carbonia.',
    categories: {
      history: {
        title: 'Storia',
        description: 'Fondazione, crescita e gli eventi che hanno plasmato la città',
      },
      landmarks: {
        title: 'Luoghi di interesse',
        description: 'Edifici, monumenti e siti di rilievo',
      },
      nature: {
        title: 'Natura',
        description: 'Habitat, fauna e paesaggio circostante',
      },
      food: {
        title: 'Gastronomia',
        description: 'Ristoranti, bar, mercati e luoghi della gastronomia',
      },
      community: {
        title: 'Comunità',
        description: 'Istituzioni, eventi e vita locale',
      },
    },
    home: {
      hero: {
        subtitle: 'Conoscenza, curata.',
        description: 'Una base di conoscenza open source dedicata a Carbonia, la città del Sulcis fondata per decreto nel 1938, pensata anche per l\'IA: storia, luoghi, natura, cucina e comunità, con articoli documentati, un grafo della conoscenza e machine-readable endpoint.',
        highlight: 'Documentata. Verificata. In continua evoluzione.',
        cta: {
          explore: 'Esplora gli argomenti',
          github: 'Metti una stella su GitHub',
        },
      },
      stats: [
        { label: 'ambiti di conoscenza' },
        { number: 'Giorno 1', label: 'della base di conoscenza' },
        { label: 'articoli con fonti tracciate' },
        { label: 'endpoint leggibili dall\'IA' },
      ],
      doors: [
        { title: 'Prima volta qui?', sub: 'Parti dalla storia' },
        { title: 'Cerca ovunque', sub: 'Testo completo su tutti gli articoli' },
        { title: 'Sorprendimi', sub: 'Un articolo a caso da approfondire' },
        { title: 'Salute del sito', sub: 'Statistiche su aggiornamento e copertura' },
      ],
      coverStory: {
        heading: 'La storia finora',
        lead: 'Ogni luogo ha una storia. Questa base di conoscenza esiste per custodire la storia di Carbonia: documentata, verificata e aperta.',
        quotes: [
          {
            era: 'Allora',
            quote: 'Il 18 dicembre 1938 il regime di Mussolini fondò Carbonia per decreto, costruendola in meno di due anni per ospitare i lavoratori del bacino carbonifero Sirai-Serbariu: una città di fondazione su un terreno che una stagione prima non aveva neppure un nome.',
            cite: 'La fondazione, 1938',
          },
          {
            era: 'Ora',
            quote: 'Le miniere che hanno costruito questa città chiusero per fasi tra gli anni Sessanta e Settanta; il più ampio bacino industriale del Sulcis lotta ancora, nel 2026, per sostituire i posti di lavoro che si sono portate via.',
            cite: 'Carbonia oggi',
          },
          {
            quote: 'Questa base di conoscenza esiste per documentare tutto questo: con fonti, verificata e aperta a chiunque voglia leggerla o migliorarla.',
            cite: 'Dichiarazione di intenti del progetto',
          },
        ],
        closing: [
          'Ogni articolo di questa base di conoscenza risale alle sue fonti.',
          'L\'obiettivo non è la promozione. L\'obiettivo è il resoconto più completo e accurato di questo luogo che esista da qualche parte.',
        ],
        aboutLinkText: 'Leggi la storia completa',
      },
      randomDiscovery: {
        button: 'Tira i dadi',
        subtitle: 'Un articolo a caso da approfondire',
        description: 'Ogni articolo ha le sue note a piè di pagina. Premi il pulsante e finisci dove non te lo aspettavi.',
      },
      features: {
        title: 'Cosa ci rende diversi',
        cards: [
          { title: 'Curata, non copiata', description: 'Ogni articolo è vagliato da una persona, anche quando la bozza nasce con l\'IA.' },
          { title: 'A misura di IA', description: 'Endpoint strutturati su /kb/ e /llms.txt per gli LLM. Pensata per macchine e persone.' },
          { title: 'Fonti tracciate', description: 'Le note citano le fonti. Le affermazioni rimandano alle prove. Le date di verifica sono visibili.' },
          { title: 'Completa', description: '5 ambiti che coprono l\'intero spettro: storia, luoghi, natura, cibo, comunità.' },
        ],
        cta: {
          graph: 'Esplora il grafo della conoscenza',
          ssot: 'Vedi la conoscenza grezza',
        },
      },
      exhibitions: {
        heading: 'Sale espositive',
        divider: 'Tutte le categorie',
        halls: [
          {
            label: 'I — Storia e luoghi di interesse',
            paragraphs: [
              {
                text: 'Fondazione, crescita e gli eventi che hanno plasmato la città. Qui trovano posto gli articoli documentati di storia, man mano che la base di conoscenza cresce.',
                pillLabel: 'Storia',
              },
              {
                text: 'Edifici, monumenti e siti di rilievo. Qui trovano posto gli articoli documentati sui luoghi di interesse, man mano che la base di conoscenza cresce.',
                pillLabel: 'Luoghi di interesse',
              },
            ],
          },
          {
            label: 'II — Natura e gastronomia',
            paragraphs: [
              {
                text: 'Habitat, fauna e paesaggio circostante. Qui trovano posto gli articoli documentati sulla natura, man mano che la base di conoscenza cresce.',
                pillLabel: 'Natura',
              },
              {
                text: 'Ristoranti, bar, mercati e luoghi della gastronomia. Qui trovano posto gli articoli documentati sulla gastronomia, man mano che la base di conoscenza cresce.',
                pillLabel: 'Gastronomia',
              },
            ],
          },
          {
            label: 'III — Comunità',
            paragraphs: [
              {
                text: 'Istituzioni, eventi e vita locale. Qui trovano posto gli articoli documentati sulla comunità, man mano che la base di conoscenza cresce.',
                pillLabel: 'Comunità',
              },
            ],
          },
        ],
      },
      recentUpdates: {
        heading: 'Aggiornamenti recenti',
        subtitle: 'Le ultime modifiche alla base di conoscenza',
        viewAll: 'Vedi tutte le modifiche',
        latestLabel: 'Ultimi articoli',
      },
      contribute: {
        heading: 'Contribuisci',
        description: 'Questo è un progetto open source. Ogni articolo, ogni fonte, ogni riga di codice è pubblica. Se sai qualcosa che ci è sfuggito, puoi correggerlo.',
        guideLabel: 'Guida al contributo',
        githubLabel: 'Vedi su GitHub',
      },
    },
  },
};

export default translations;
