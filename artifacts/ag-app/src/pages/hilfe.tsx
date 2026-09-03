import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  CircleHelp,
  ClipboardList,
  FileKey2,
  FileText,
  Layers3,
  Lightbulb,
  ListFilter,
  Mail,
  MessageSquareText,
  Search,
  ShieldCheck,
  Sparkles,
  Timer,
  X,
} from 'lucide-react';

type Topic = {
  id: string;
  label: string;
  kicker: string;
  description: string;
  icon: typeof BookOpen;
  accent: string;
  articles: Article[];
};

type Article = {
  id: string;
  title: string;
  summary: string;
  steps: string[];
  tags: string[];
};

type FAQ = {
  id: string;
  question: string;
  answer: string;
  topic: string;
};

const topics: Topic[] = [
  {
    id: 'start',
    label: 'Erste Schritte',
    kicker: 'Orientierung',
    description: 'Die wichtigsten Handgriffe für einen guten Start als Auftraggeber.',
    icon: Sparkles,
    accent: 'text-amber-300 bg-amber-300/10 border-amber-200/20',
    articles: [
      {
        id: 'start-01',
        title: 'In 10 Minuten arbeitsbereit',
        summary: 'Prüfen Sie zuerst Organisation, Projekte und Ihre Rolle. Danach können Sie Projekt-Policy, Leistungsanfragen und unabhängige Datenpakete sauber trennen.',
        steps: [
          'Öffnen Sie Projekte und wählen Sie das aktive Bauvorhaben.',
           'Legen Sie Leistungen und die benötigten Leistungsanfragen an.',
          'Prüfen Sie die Projekt-Policy und lassen Sie für jede Leistungsanfrage automatisch eine passende Child-Policy aus Ihrer Auswahl erzeugen.',
        ],
        tags: ['Onboarding', 'Rolle', 'Projekt'],
      },
      {
        id: 'start-02',
        title: 'Die AG-Rolle im Überblick',
        summary: 'Als Auftraggeber steuern Sie, welche Informationen für welches Nachunternehmen sichtbar werden und wann eine Anfrage entscheidungsreif ist.',
        steps: [
          'Planen Sie mit internen Projektdaten.',
          'Geben Sie nur ausgewählte Inhalte ausdrücklich frei.',
          'Bewerten Sie Antworten und halten Sie Entscheidungen im Projekt fest.',
        ],
        tags: ['Auftraggeber', 'Verantwortung'],
      },
    ],
  },
  {
    id: 'projects',
     label: 'Projekte & Leistungen',
    kicker: 'Arbeitsablauf',
    description: 'Vom Projektüberblick zum konkreten Zeitfenster auf der Baustelle.',
    icon: Layers3,
    accent: 'text-sky-300 bg-sky-300/10 border-sky-200/20',
    articles: [
      {
        id: 'projects-01',
        title: 'Projekte und Leistungen lesen',
        summary: 'Ein Projekt bündelt die Koordination. Leistungen teilen den Bauablauf in nachvollziehbare, terminierte Arbeitsfenster.',
        steps: [
          'Starten Sie im Projektüberblick und prüfen Sie den aktuellen Status.',
          'Öffnen Sie eine Leistung, um Zeitfenster und beteiligte Gewerke zu sehen.',
          'Nutzen Sie die Leistung als Bezugspunkt für Leistungsanfragen.',
        ],
        tags: ['Projekt', 'Leistung', 'Termin'],
      },
      {
        id: 'projects-02',
        title: 'Leistungen sicher freigeben',
        summary: 'Die Leistungsfreigabe folgt immer der akzeptierten Projektvereinbarung und ist kein Datenangebot.',
        steps: [
          'Beispiel Rahmentermine: Geben Sie Leistungsname, geplanten Zeitraum, Puffer, Ausführungsbereich und relevante Abhängigkeiten frei – niemals Ressourcen, Personal, Kosten oder Projektbeschreibung.',
          'Beispiel Leistungskoordination: Ergänzen Sie nur die Angaben, die der AN zur Koordination der ausgewählten Leistung benötigt.',
          'Bei einer echten Erweiterung der vereinbarten Nutzung erhält der AN neue Nutzungsbedingungen zur Annahme oder Ablehnung.',
          'BIM-Modelle, Logistikpakete und Dokumentpakete senden Sie weiterhin als separates Datenangebot.',
        ],
        tags: ['Leistungsfreigabe', 'Rahmentermine', 'Projektvereinbarung'],
      },
      {
        id: 'projects-02',
        title: 'Die Leistungsanfrage gibt gezielt Informationen frei',
        summary: 'Eine Leistung ist der fachliche Bezug. Erst die konkrete Leistungsanfrage beschreibt, welche Informationen für diese Leistung, zu welchem Zweck und in welchem Zeitraum gezielt freigegeben werden.',
        steps: [
          'Wählen Sie Projekt, AN, Leistung, benötigte Informationen, Zweck, Zeitraum und Antwortfrist aus.',
          'Lassen Sie daraus automatisch die leistungsbezogene Policy erzeugen, die auf die Projekt-Policy verweist.',
          'Prüfen Sie die Zusammenfassung und das Delta-Ergebnis vor dem Senden.',
        ],
        tags: ['Sichtbarkeit', 'Policy', 'Leistung'],
      },
    ],
  },
  {
    id: 'requests',
    label: 'Leistungsanfragen',
    kicker: 'Ausschreibung',
    description: 'Anforderungen klar formulieren, Antworten vergleichen und weiterarbeiten.',
    icon: ClipboardList,
    accent: 'text-teal-300 bg-teal-300/10 border-teal-200/20',
    articles: [
      {
        id: 'requests-01',
        title: 'Eine Leistungsanfrage stellen',
        summary: 'Beschreiben Sie Leistung, Rahmenbedingungen und gewünschten Rückmeldezeitpunkt so, dass ein Nachunternehmen belastbar antworten kann.',
        steps: [
          'Öffnen Sie Leistungsanfragen und wählen Sie Neue Anfrage.',
          'Ordnen Sie die Anfrage einem Projekt und bei Bedarf einer Leistung zu.',
          'Wählen Sie AN, freigegebene Leistungsinformationen, Nutzungszweck, Zeitraum, Antwortfrist und weitere Bedingungen.',
          'Prüfen Sie: Innerhalb der Projektvereinbarung ist keine erneute Zustimmung nötig; bei neuen Bedingungen wird das Policy-Delta ausgewiesen.',
          'Senden Sie die Anfrage erst ab, wenn alle Pflichtangaben geprüft sind.',
        ],
        tags: ['Anfrage', 'Anforderung', 'Empfänger'],
      },
      {
        id: 'requests-03',
        title: 'Beispiel: Bewehrung Decke EG im Neubau Bochum',
        summary: 'Für Musterbau GmbH erstellt die AG aus ihrer konkreten Auswahl eine nachvollziehbare Leistungs-Child-Policy – ohne technische Policy-Auswahl durch den Nutzer.',
        steps: [
          'Wählen Sie Projekt „Neubau Bochum“, AN „Musterbau GmbH“ und die Leistung „Bewehrung Decke EG“.',
          'Geben Sie nur den erforderlichen Leistungssnapshot, den Zweck „Ausführung vorbereiten“ und den Zeitraum 17.–18.09.2026 frei.',
          'Setzen Sie die Antwortfrist und prüfen Sie die Zusammenfassung: „innerhalb Projektvereinbarung – keine erneute Zustimmung erforderlich“.',
          'Senden Sie die Leistungsanfrage. Der AN kann direkt Anfrage prüfen, Machbarkeit prüfen und Rückmeldung senden.',
        ],
        tags: ['Neubau Bochum', 'Musterbau GmbH', 'Bewehrung Decke EG', 'Beispiel'],
      },
      {
        id: 'requests-02',
        title: 'Antworten einordnen',
        summary: 'Eine Antwort kann den angefragten Ablauf bestätigen oder eine Terminänderung enthalten. Prüfen Sie immer Termin, Voraussetzungen und offene Punkte gemeinsam.',
        steps: [
          'Öffnen Sie die Anfrage und lesen Sie die Rückmeldung im Kontext.',
          'Vergleichen Sie vorgeschlagenes Zeitfenster und Anforderungen.',
          'Halten Sie Rückfragen oder Ihre Entscheidung am Vorgang fest.',
        ],
        tags: ['Antwort', 'Vorschlag', 'Entscheidung'],
      },
    ],
  },
  {
    id: 'schedule',
    label: 'Termine & Änderungen',
    kicker: 'Abstimmung',
    description: 'Vorschläge prüfen, Konflikte sichtbar machen und Termine verlässlich abstimmen.',
    icon: Timer,
    accent: 'text-violet-300 bg-violet-300/10 border-violet-200/20',
    articles: [
      {
        id: 'schedule-01',
        title: 'Terminänderungen als Revision behandeln',
        summary: 'Eine Terminänderung ist eine Revision der bestehenden Leistungsvereinbarung und baut auf derselben Policy-Hierarchie auf.',
        steps: [
          'Prüfen Sie die Änderung von 17.–18.09.2026 auf 21.–22.09.2026 gegen den Projektablauf.',
          'Bewerten Sie Voraussetzungen und Auswirkungen auf andere Gewerke; die Projektmitgliedschaft wird nicht erneut angefragt.',
          'Übernehmen Sie die Revision erst nach beiderseitiger Zustimmung. Bis dahin bleibt 17.–18.09.2026 gültig.',
        ],
        tags: ['Vorschlag', 'Leistung', 'Konflikt'],
      },
      {
        id: 'schedule-02',
        title: 'Was bedeutet „offen“?',
        summary: 'Offen heißt: Es liegt noch keine abschließende Bestätigung für die Leistungsanfrage oder Terminänderung vor. Die bisherige Vereinbarung bleibt gültig.',
        steps: [
          'Öffnen Sie die Anfrage, um die letzte Aktivität zu prüfen.',
          'Senden Sie bei Bedarf eine Rückfrage an das Nachunternehmen.',
          'Aktualisieren Sie die Entscheidung, sobald die neue Vereinbarung beiderseitig bestätigt ist.',
        ],
        tags: ['Status', 'Offen', 'Entscheidung'],
      },
    ],
  },
  {
    id: 'data',
    label: 'Datenraum & Policies',
    kicker: 'Zugriff',
    description: 'Kontrollieren Sie Datenzugriff verständlich und nachvollziehbar.',
    icon: FileKey2,
    accent: 'text-rose-300 bg-rose-300/10 border-rose-200/20',
    articles: [
      {
        id: 'data-01',
        title: 'Projekt-Policy und Leistungs-Child-Policy',
        summary: 'Die beim Projektbeitritt akzeptierte Projekt-Policy ist die einmalige Rahmenvereinbarung. Jede Leistungsanfrage konkretisiert oder beschränkt diesen Rahmen für genau eine Leistung.',
        steps: [
          'Laden Sie das Nachunternehmen ein und legen Sie die Projekt-Policy als Rahmen der Zusammenarbeit fest.',
          'Wählen Sie für die Leistungsanfrage nur die erforderlichen Informationen, Zweck, Zeitraum und Bedingungen aus.',
          'Zeigen Sie die automatisch erzeugte Child-Policy und das Delta vor dem Senden an.',
        ],
        tags: ['Einladung', 'Veröffentlichung', 'Zugriff'],
      },
      {
        id: 'data-02',
        title: 'Policy-Delta richtig bewerten',
        summary: 'Eine Leistungsanfrage darf die Projekt-Policy konkretisieren oder einschränken. Neue Zwecke, längere Aufbewahrung, weitergehende Weitergabe oder zusätzliche Pflichten sind ein bestätigungspflichtiges Delta.',
        steps: [
          'Vergleichen Sie die automatisch erzeugte Leistungs-Policy mit der akzeptierten Projekt-Policy.',
          'Liegt alles innerhalb des Rahmens, zeigen Sie „keine erneute Zustimmung erforderlich“ an.',
          'Bei einem zulässigen Delta muss der AN die Erweiterung vor Detaildatenzugriff bestätigen; außerhalb des zulässigen Rahmens ist eine Änderung der Projektvereinbarung nötig.',
          'Das Construct-X-Modell beschreibt diese fachliche Hierarchie; Tractus-X/EDC transportiert an der technischen Grenze nur die vollständig aufgelöste effektive Policy.',
        ],
        tags: ['Policy', 'ODRL', 'Datenraum'],
      },
    ],
  },
  {
    id: 'support',
    label: 'Fehler & Begriffe',
    kicker: 'Nachschlagen',
    description: 'Kurze Antworten, wenn etwas nicht wie erwartet aussieht.',
    icon: CircleHelp,
    accent: 'text-orange-300 bg-orange-300/10 border-orange-200/20',
    articles: [
      {
        id: 'support-01',
        title: 'Leistungsdetails sind noch nicht sichtbar',
        summary: 'Prüfen Sie Projektmitgliedschaft und Leistungs-Policy. Eine normale Leistungsanfrage innerhalb des Projekt-Rahmens braucht keine zweite Projekt- oder Datenfreigabe.',
        steps: [
          'Prüfen Sie, ob der AN ACTIVE-Projektmitglied ist und die Leistungsanfrage in Phase 1 geöffnet hat.',
          'Lesen Sie die angezeigte Child-Policy und das Ergebnis der Delta-Prüfung.',
          'Bei einem echten Delta muss der AN zuerst die Erweiterung bestätigen; bei NOT_PERMITTED muss die AG die Projektvereinbarung ändern.',
        ],
        tags: ['Fehler', 'Sichtbarkeit', 'Policy'],
      },
      {
        id: 'support-02',
        title: 'Wichtige Begriffe',
        summary: 'AG ist der Auftraggeber, AN das Nachunternehmen. Die Projekt-Policy ist der Rahmen; die Leistungsanfrage ist die fachliche, versionierte Child-Policy für eine konkrete Leistung.',
        steps: [
          'AG: steuert Projekt, Veröffentlichungen und Entscheidungen.',
          'AN: erhält den erforderlichen Leistungssnapshot und antwortet im 3-Phasen-Prozess.',
          'DataOffer: bleibt ein unabhängiges Datenpaket, etwa BIM-Modell, Logistikkonzept oder Dokumentenpaket.',
        ],
        tags: ['AG', 'AN', 'Glossar'],
      },
    ],
  },
];

const faqs: FAQ[] = [
  {
    id: 'faq-invite',
    question: 'Werden durch eine Einladung automatisch Projektdaten geteilt?',
    answer: 'Die Einladung ist der einmalige Projektbeitritt mit der Projekt-Policy als Rahmenvereinbarung. Nach Annahme wird die Projektmitgliedschaft ACTIVE. Eine normale Leistungsanfrage erzeugt daraus eine gezielte Child-Policy für den erforderlichen Leistungssnapshot; eine zweite Projektzugehörigkeit oder separate DataOffer-Bestätigung ist dafür nicht nötig.',
    topic: 'Datenraum & Policies',
  },
  {
    id: 'faq-policy',
    question: 'Was prüfe ich, wenn ein AN eine Information nicht sieht?',
     answer: 'Prüfen Sie, ob der AN ACTIVE-Projektmitglied ist, welche Informationen die Leistungsanfrage freigibt und ob das Policy-Delta innerhalb des Projekt-Rahmens liegt. Bei einem echten, zulässigen Delta muss der AN die Erweiterung vor dem Detaildatenzugriff bestätigen; bei NOT_PERMITTED muss die Projektvereinbarung geändert werden.',
    topic: 'Datenraum & Policies',
  },
  {
    id: 'faq-request',
    question: 'Kann ich eine Leistungsanfrage nach dem Versand noch einordnen?',
    answer: 'Öffnen Sie den Vorgang und prüfen Sie Status, Policy-Zusammenfassung und Delta-Ergebnis. Der AN sieht bei einem passenden Projekt-Rahmen direkt die drei Phasen Anfrage prüfen, Machbarkeit prüfen und Rückmeldung senden.',
    topic: 'Leistungsanfragen',
  },
  {
    id: 'faq-service',
    question: 'Wie hängen Leistungen und Leistungsanfragen zusammen?',
    answer: 'Eine Leistung ist der fachliche Bezug. Die Leistungsanfrage beschreibt dazu den erforderlichen Leistungssnapshot, Zweck, Zeitraum, Antwortfrist und Bedingungen als versionierte Child-Policy der Projekt-Policy.',
    topic: 'Projekte & Leistungen',
  },
  {
    id: 'faq-open',
    question: 'Was ist der nächste Schritt bei einer offenen Antwort?',
    answer: 'Lesen Sie die Terminänderung vollständig, vergleichen Sie sie mit dem Projektablauf und klären Sie offene Voraussetzungen. Erst danach sollten Sie die Terminentscheidung weitergeben.',
    topic: 'Termine & Änderungen',
  },
  {
    id: 'faq-data-offer',
    question: 'Wann brauche ich ein separates DataOffer?',
    answer: 'Nur für unabhängige zusätzliche Datenpakete, zum Beispiel ein BIM-Modell, ein Logistikkonzept oder ein Dokumentenpaket. Ein DataOffer ist kein Pflichtschritt für eine normale Leistungsanfrage und ersetzt deren leistungsbezogene Child-Policy nicht.',
    topic: 'Datenraum & Policies',
  },
];

function normalize(value: string) {
  return value.toLocaleLowerCase('de-DE').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function articleMatches(article: Article, query: string) {
  if (!query.trim()) return true;
  const haystack = normalize([article.title, article.summary, ...article.steps, ...article.tags].join(' '));
  return haystack.includes(normalize(query));
}

export default function Hilfe() {
  const [query, setQuery] = useState('');
  const [activeTopic, setActiveTopic] = useState('all');
  const [openFaq, setOpenFaq] = useState<string | null>('faq-invite');

  const filteredTopics = useMemo(
    () =>
      topics
        .filter((topic) => activeTopic === 'all' || topic.id === activeTopic)
        .map((topic) => ({ ...topic, articles: topic.articles.filter((article) => articleMatches(article, query)) }))
        .filter((topic) => topic.articles.length > 0),
    [activeTopic, query],
  );

  const filteredFaqs = useMemo(
    () =>
      faqs.filter((faq) => {
        if (activeTopic !== 'all' && faq.topic !== topics.find((topic) => topic.id === activeTopic)?.label) return false;
        return !query.trim() || articleMatches({ id: faq.id, title: faq.question, summary: faq.answer, steps: [], tags: [faq.topic] }, query);
      }),
    [activeTopic, query],
  );

  const resultCount = filteredTopics.reduce((sum, topic) => sum + topic.articles.length, 0) + filteredFaqs.length;

  return (
    <div className="mx-auto max-w-7xl pb-16">
      <div className="mb-7 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-primary" />
          <span className="font-semibold tracking-wide text-foreground">Hilfe</span>
          <span className="text-muted-foreground/50">/</span>
          <span>Auftraggeber</span>
        </div>
         <span data-testid="text-help-updated">Für aktuelle Abläufe</span>
      </div>

      <section className="relative overflow-hidden rounded-2xl border border-primary/20 bg-[linear-gradient(120deg,hsl(var(--card))_0%,hsl(var(--sidebar))_72%)] px-6 py-8 shadow-2xl shadow-black/10 sm:px-10 sm:py-11">
        <div className="pointer-events-none absolute -right-16 -top-24 h-72 w-72 rounded-full border border-primary/10" />
        <div className="pointer-events-none absolute -right-5 -top-14 h-48 w-48 rounded-full border border-primary/10" />
        <div className="relative max-w-3xl">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-primary">
            <ShieldCheck className="h-3.5 w-3.5" />
            Arbeitsbegleiter für AG
          </div>
          <h1 className="max-w-2xl text-3xl font-extrabold tracking-[-0.04em] text-foreground sm:text-5xl">
            Sicher koordinieren.
            <span className="block text-primary">Auch wenn es schnell gehen muss.</span>
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
             Praktische Antworten für Projektsteuerung, Leistungen und Policy-geprüfte Leistungsanfragen. Suchen Sie nach einem Begriff oder wählen Sie ein Thema.
          </p>

          <div className="relative mt-7 max-w-2xl">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-primary" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Zum Beispiel: Einladung, Policy oder Terminänderung"
              aria-label="Hilfe durchsuchen"
              data-testid="input-help-search"
              className="h-14 w-full rounded-xl border border-primary/30 bg-background/80 pl-12 pr-12 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Suche leeren"
                data-testid="button-clear-help-search"
                className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <ListFilter className="h-3.5 w-3.5" />
            <span data-testid="text-help-result-count">{resultCount} {resultCount === 1 ? 'Treffer' : 'Treffer'} in den Themen und FAQs</span>
          </div>
        </div>
      </section>

      <section className="mt-7 grid gap-4 rounded-xl border border-amber-200/20 bg-amber-300/[0.06] p-5 sm:grid-cols-[auto_1fr_auto] sm:items-center sm:px-6" data-testid="callout-invitation-publication">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-amber-200/20 bg-amber-300/10 text-amber-300">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-bold text-amber-100">Wichtig: Rahmenvereinbarung und Leistungsanfrage sind nicht dasselbe</p>
           <p className="mt-1 max-w-3xl text-xs leading-5 text-amber-100/65">
             Die Projekt-Policy wird beim Projektbeitritt einmalig akzeptiert. Eine Leistungsanfrage erzeugt daraus automatisch die gezielte Child-Policy für den erforderlichen Leistungssnapshot; ein separates DataOffer bleibt unabhängigen Datenpaketen vorbehalten.
          </p>
        </div>
        <Link href="/data-room" data-testid="link-help-data-room" className="inline-flex items-center gap-2 text-xs font-bold text-amber-300 transition-colors hover:text-amber-100">
          Datenraum öffnen <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </section>

      <div className="mt-10 grid gap-10 lg:grid-cols-[220px_1fr]">
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
            <ListFilter className="h-3.5 w-3.5 text-primary" /> Themen
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2 lg:block lg:space-y-1 lg:overflow-visible" data-testid="list-help-topics">
            <button
              type="button"
              onClick={() => setActiveTopic('all')}
              data-testid="button-topic-all"
              className={`flex min-w-max items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors lg:w-full ${activeTopic === 'all' ? 'bg-primary/15 font-bold text-primary' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'}`}
            >
              Alle Themen <span className="font-mono text-[10px] text-muted-foreground">{topics.reduce((sum, topic) => sum + topic.articles.length, 0)}</span>
            </button>
            {topics.map((topic) => {
              const Icon = topic.icon;
              return (
                <button
                  key={topic.id}
                  type="button"
                  onClick={() => setActiveTopic(topic.id)}
                  data-testid={`button-topic-${topic.id}`}
                  className={`flex min-w-max items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-colors lg:w-full ${activeTopic === topic.id ? 'bg-primary/15 font-bold text-primary' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'}`}
                >
                  <Icon className="h-4 w-4" />
                  {topic.label}
                </button>
              );
            })}
          </div>
          <div className="mt-5 hidden rounded-lg border border-border/70 bg-card/50 p-4 lg:block">
            <p className="flex items-center gap-2 text-xs font-bold text-foreground"><Lightbulb className="h-4 w-4 text-primary" /> Schnellhilfe</p>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">Starten Sie mit „Erste Schritte“, wenn Sie das erste Projekt einrichten.</p>
          </div>
        </aside>

        <main className="min-w-0">
          {filteredTopics.length === 0 && filteredFaqs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card/30 px-6 py-14 text-center" data-testid="empty-help-results">
              <Search className="mx-auto h-8 w-8 text-muted-foreground/60" />
              <h2 className="mt-4 text-lg font-bold text-foreground">Keine passende Hilfe gefunden</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">Versuchen Sie einen kürzeren Begriff oder wählen Sie „Alle Themen“. Die Suche arbeitet nur mit den Inhalten dieser Seite.</p>
              <button type="button" onClick={() => { setQuery(''); setActiveTopic('all'); }} data-testid="button-reset-help-search" className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90">
                Suche zurücksetzen <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <>
              {filteredTopics.map((topic) => {
                const Icon = topic.icon;
                return (
                  <section key={topic.id} className="mb-10" data-testid={`section-help-topic-${topic.id}`}>
                    <div className="mb-4 flex items-start gap-3">
                      <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${topic.accent}`}><Icon className="h-5 w-5" /></div>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.17em] text-primary">{topic.kicker}</p>
                        <h2 className="mt-1 text-xl font-extrabold tracking-tight text-foreground">{topic.label}</h2>
                        <p className="mt-1 text-sm text-muted-foreground">{topic.description}</p>
                      </div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      {topic.articles.map((article) => (
                        <article key={article.id} className="group rounded-xl border border-border/80 bg-card/55 p-5 transition-colors hover:border-primary/30 hover:bg-card" data-testid={`card-help-article-${article.id}`}>
                          <div className="flex items-start justify-between gap-3">
                            <h3 className="text-sm font-bold leading-5 text-foreground">{article.title}</h3>
                            <FileText className="h-4 w-4 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-primary" />
                          </div>
                          <p className="mt-2 text-xs leading-5 text-muted-foreground">{article.summary}</p>
                          <div className="mt-4 border-t border-border/60 pt-3">
                            <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Nächste Schritte</p>
                            <ol className="space-y-2">
                              {article.steps.map((step, index) => (
                                <li key={step} className="flex gap-2 text-xs leading-5 text-foreground/80">
                                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/15 font-mono text-[9px] font-bold text-primary">{index + 1}</span>
                                  <span>{step}</span>
                                </li>
                              ))}
                            </ol>
                          </div>
                          <div className="mt-4 flex flex-wrap gap-1.5">
                            {article.tags.map((tag) => <span key={tag} className="rounded border border-border/70 bg-muted/30 px-2 py-1 font-mono text-[9px] text-muted-foreground">{tag}</span>)}
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                );
              })}

              {filteredFaqs.length > 0 && (
                <section className="border-t border-border/70 pt-8" data-testid="section-help-faq">
                  <div className="mb-4 flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-orange-200/20 bg-orange-300/10 text-orange-300"><MessageSquareText className="h-5 w-5" /></div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.17em] text-primary">Kurz beantwortet</p>
                      <h2 className="mt-1 text-xl font-extrabold tracking-tight text-foreground">Häufige Fragen</h2>
                      <p className="mt-1 text-sm text-muted-foreground">Klare Antworten für den Moment, in dem der nächste Schritt zählt.</p>
                    </div>
                  </div>
                  <div className="divide-y divide-border/70 overflow-hidden rounded-xl border border-border/80 bg-card/55">
                    {filteredFaqs.map((faq) => {
                      const isOpen = openFaq === faq.id;
                      return (
                        <div key={faq.id} data-testid={`faq-item-${faq.id}`}>
                          <button
                            type="button"
                            onClick={() => setOpenFaq(isOpen ? null : faq.id)}
                            aria-expanded={isOpen}
                            data-testid={`button-faq-${faq.id}`}
                            className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-muted/30"
                          >
                            <span className="text-sm font-semibold text-foreground">{faq.question}</span>
                            <ChevronDown className={`h-4 w-4 shrink-0 text-primary transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                          </button>
                          {isOpen && (
                            <div className="flex gap-3 px-5 pb-5 text-sm leading-6 text-muted-foreground" data-testid={`answer-faq-${faq.id}`}>
                              <Check className="mt-1 h-4 w-4 shrink-0 text-teal-300" />
                              <div><p>{faq.answer}</p><p className="mt-2 text-xs font-semibold text-primary">{faq.topic}</p></div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}
            </>
          )}

          <section className="mt-10 flex flex-col gap-4 rounded-xl border border-border/80 bg-muted/20 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6" data-testid="help-contact-note">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Mail className="h-4 w-4" /></div>
              <div><p className="text-sm font-bold text-foreground">Noch nicht weiter?</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Halten Sie Projekt, Leistung und betroffenen Vorgang bereit, wenn Sie Unterstützung anfragen.</p></div>
            </div>
            <Link href="/settings" data-testid="link-help-settings" className="inline-flex shrink-0 items-center gap-2 text-xs font-bold text-primary transition-colors hover:text-primary/80">Profil & Organisation <ArrowRight className="h-3.5 w-3.5" /></Link>
          </section>
        </main>
      </div>
    </div>
  );
}