import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  FileCheck2,
  Hammer,
  HelpCircle,
  Inbox,
  LifeBuoy,
  MessageSquare,
  Search,
  ShieldCheck,
  Users,
  Wrench,
  X,
} from "lucide-react";

type HelpArticle = {
  id: string;
  group: string;
  title: string;
  summary: string;
  steps: string[];
  keywords: string;
  icon: typeof BookOpen;
};

type Faq = {
  id: string;
  question: string;
  answer: string;
  group: string;
};

const topicGroups = [
  { id: "start", label: "Start & Zugang", icon: BookOpen },
  { id: "projects", label: "Projekte & Daten", icon: ShieldCheck },
   { id: "coordination", label: "Leistungsanfragen", icon: ClipboardList },
  { id: "resources", label: "Ressourcen & Termine", icon: Wrench },
  { id: "communication", label: "Nachrichten", icon: MessageSquare },
  { id: "troubleshooting", label: "Klärung & Begriffe", icon: LifeBuoy },
];

const articles: HelpArticle[] = [
  {
    id: "getting-started",
    group: "start",
    title: "In drei Schritten arbeitsbereit",
    summary:
      "Nach der Registrierung führt dich der Arbeitsbereich von der Einladung bis zur ersten Rückmeldung.",
    steps: [
      "Profil und Zuständigkeit prüfen: Hinterlege die Ansprechperson für dein Nachunternehmen und kontrolliere die Benachrichtigungsadresse.",
      "Einladung öffnen: Prüfe Bauvorhaben, einladende Organisation, Rolle und Projekt-Policy. Nach deiner Annahme bist du ACTIVE-Projektmitglied.",
      "Leistungsanfrage öffnen: Eine normale Anfrage ist die gezielte Freigabe des erforderlichen Leistungssnapshots – ohne zweite Projekt- oder DataOffer-Bestätigung.",
    ],
    keywords: "registrierung profil arbeitsbereich zugang rolle",
    icon: BookOpen,
  },
  {
    id: "invitations",
    group: "projects",
    title: "Projekteinladung als Rahmenvereinbarung",
    summary:
      "Die Projekteinladung ist der einmalige Projektbeitritt. Mit deiner Annahme der Projekt-Policy wird deine Projektmitgliedschaft ACTIVE; spätere Leistungsanfragen ändern diese Mitgliedschaft nicht.",
    steps: [
      "Öffne die Einladung aus Anfragen oder über den Link in deiner E-Mail. Beispiel: Projekt „Neubau Bochum“, einladende AG und AN „Musterbau GmbH“.",
      "Lies Projekt-Policy, Zweck der Zusammenarbeit und vorgesehene Rolle vollständig.",
      "Wähle Einladung annehmen oder ablehnen. Nur bei Annahme wird die Projektmitgliedschaft ACTIVE; eine spätere Leistungsablehnung beendet sie nicht.",
    ],
    keywords: "einladung projektmitglied aktiv ablehnen annehmen projekt",
    icon: Users,
  },
  {
    id: "data-policies",
    group: "projects",
    title: "Projekt-Policy und Leistungs-Child-Policy",
    summary:
      "Die Projekt-Policy ist dein einmaliger Rahmen. Eine Leistungsanfrage konkretisiert oder beschränkt ihn für eine konkrete Leistung und gibt genau den dafür erforderlichen Leistungssnapshot frei.",
    steps: [
      "Öffne die Leistungsanfrage und lies in Phase 1 Leistung, freigegebene Informationen, Zweck, Zeitraum, Antwortfrist und fachliche Bedingungen.",
      "Liegt die Child-Policy vollständig innerhalb der akzeptierten Projekt-Policy, ist keine neue ausdrückliche Zustimmung nötig.",
      "Prüfe danach den Leistungssnapshot und fahre direkt mit Machbarkeit prüfen und Rückmeldung senden fort.",
      "Beispiel Rahmentermine: Du siehst Leistungsname, Zeitraum, Puffer, Bereich und Abhängigkeiten – keine Ressourcen-, Personal-, Kosten- oder Projektdaten.",
      "Nur bei einer echten Erweiterung erscheint „Neue Nutzungsbedingungen“ mit der Abweichung. BIM-, Logistik- und Dokumentpakete bleiben separate Datenangebote.",
    ],
    keywords: "datenraum leistungsanfrage child-policy projekt-policy policy-delta dataoffer bim logistikkonzept dokumentenpaket sichtbar datenschutz",
    icon: ShieldCheck,
  },
  {
    id: "requests",
    group: "coordination",
    title: "Leistungsanfragen beantworten",
    summary:
      "Leistungsanfragen sind versionierte fachliche Child-Policies. Sie bündeln die gezielte Freigabe für eine Leistung und führen dich direkt durch drei Phasen.",
    steps: [
      "Öffne zum Beispiel die Anfrage für „Bewehrung Decke EG“ im Projekt „Neubau Bochum“ von „Musterbau GmbH“ und prüfe Phase 1: Informationen, Zweck und Zeitraum 17.–18.09.2026.",
      "Prüfe in Phase 2 deine Machbarkeit und trage verfügbar, bedingt verfügbar oder nicht verfügbar ein.",
      "Sende in Phase 3 die Rückmeldung. Sie wird mit Version und Zeitstempel im Anfrageverlauf sichtbar.",
    ],
    keywords: "leistungsanfrage antwort status rückmeldung frist verfügbar",
    icon: ClipboardList,
  },
  {
    id: "time-window",
    group: "coordination",
    title: "Policy-Delta und zusätzliche Bestätigung",
    summary:
      "Neue Zwecke, weitergehende Weitergabe, längere Aufbewahrung oder zusätzliche Pflichten sind eine echte Policy-Erweiterung. Dann wird zuerst nur das Delta angezeigt.",
    steps: [
      "Lies das Delta in Phase 1 und vergleiche es mit der Projekt-Policy. Die eigentlichen Leistungsdetaildaten bleiben bis zur Entscheidung geschützt.",
      "Bestätige die zulässige Policy-Erweiterung ausdrücklich, wenn du sie für die Leistung akzeptierst.",
      "Bei NOT_PERMITTED kannst du nicht fortfahren: Dann muss die Projektvereinbarung geändert werden. Deine Projektmitgliedschaft bleibt dabei ACTIVE.",
    ],
    keywords: "alternativer zeitraum vorschlag vorleistung personal material",
    icon: CalendarDays,
  },
  {
    id: "availability",
    group: "resources",
    title: "Verfügbarkeit und lokale Ressourcen",
    summary:
      "Pflege deine Kapazitäten dort, wo du sie steuern kannst: in deinen lokalen Projektdaten und Ressourcen.",
    steps: [
      "Öffne Ressourcen und wähle das passende lokale Projekt.",
      "Aktualisiere verfügbare Teams, Geräte oder Kapazitäten. Formuliere Hinweise so, dass sie für die Planung direkt nutzbar sind.",
      "Bei einer Verfügbarkeitsprüfung prüfst du zuerst Zeitraum und Bedarf, bevor du eine Zu- oder Absage abgibst.",
    ],
    keywords: "verfügbarkeit ressourcen team gerät kapazität lokale projekte prüfen",
    icon: Wrench,
  },
  {
    id: "schedule",
    group: "resources",
    title: "Terminänderung als Revision",
    summary:
      "Eine Terminänderung ist eine Revision der bestehenden Leistungsvereinbarung und verlangt keine erneute Bestätigung des Projektbeitritts.",
    steps: [
      "Öffne die Revision für „Bewehrung Decke EG“ und vergleiche 17.–18.09.2026 mit dem neuen Vorschlag 21.–22.09.2026.",
      "Prüfe Voraussetzungen und Auswirkungen. Die bisherige Leistungsvereinbarung bleibt gültig, solange du und die AG nicht beide zugestimmt haben.",
      "Bestätige oder beantworte die Änderung über die zugehörige Leistungsanfrage; die Projektmitgliedschaft wird nicht erneut angefragt.",
    ],
    keywords: "terminübersicht buchung kalender konflikt bestätigung zeitraum",
    icon: CalendarDays,
  },
  {
    id: "messages",
    group: "communication",
    title: "Nachrichten im Projektkontext",
    summary:
      "Nachrichten halten Rückfragen und Entscheidungen nachvollziehbar. Nutze immer den passenden Projekt- oder Anfragekontext.",
    steps: [
      "Öffne Nachrichten und wähle den Thread zur Anfrage oder zum Projekt.",
      "Schreibe konkret: Was ist betroffen, was hat sich geändert und welche Antwort brauchst du?",
      "Markiere den Thread erst als erledigt, wenn die nächste Aktion geklärt ist. Der Verlauf bleibt für die Beteiligten nachvollziehbar.",
    ],
    keywords: "nachrichten thread rückfrage projekt antwort verlauf",
    icon: MessageSquare,
  },
];

const faqs: Faq[] = [
  {
    id: "invitation-vs-data",
    group: "projects",
    question: "Ist die Projekt-Einladung dasselbe wie eine Leistungsanfrage?",
    answer:
      "Die Einladung ist der einmalige Projektbeitritt mit Projekt-Policy. Nach Annahme wird die Mitgliedschaft ACTIVE. Eine normale Leistungsanfrage ist danach eine konkrete Child-Policy und gezielte Freigabe des erforderlichen Leistungssnapshots – ohne zweite Projekt- oder DataOffer-Bestätigung.",
  },
  {
    id: "not-seeing-data",
    group: "projects",
    question: "Warum sehe ich Projektdaten nicht?",
    answer:
      "Prüfe zuerst, ob du ACTIVE-Projektmitglied bist. Öffne danach die Leistungsanfrage und lies die Projekt-Policy, die Child-Policy und das Delta-Ergebnis. Bei einer normalen Anfrage ist keine neue Zustimmung nötig; bei einem zulässigen Delta musst du zuerst die Erweiterung bestätigen. Bei NOT_PERMITTED muss die AG die Projektvereinbarung ändern.",
  },
  {
    id: "request-status",
    group: "coordination",
    question: "Was bedeuten die Status einer Leistungsanfrage?",
    answer:
      "Offen bedeutet, dass deine Rückmeldung erwartet wird. Beantwortet zeigt, dass du eine Antwort gesendet hast. In Klärung gibt es eine Rückfrage oder einen Alternativvorschlag. Abgeschlossen bedeutet, dass die Koordination die Anfrage beendet hat.",
  },
  {
    id: "policy-delta",
    group: "coordination",
    question: "Wann muss ich ein Policy-Delta bestätigen?",
    answer:
      "Wenn die Leistungsanfrage vollständig im bereits akzeptierten Projekt-Rahmen liegt, siehst du in Phase 1 „innerhalb Projektvereinbarung – keine erneute Zustimmung erforderlich“. Enthält sie einen neuen Nutzungszweck, weitergehende Weitergabe, längere Aufbewahrung oder zusätzliche Pflichten, musst du genau diese Erweiterung vor dem Abruf der Detaildaten ausdrücklich bestätigen. Außerhalb des zulässigen Rahmens steht NOT_PERMITTED; dann ist eine Änderung der Projektvereinbarung nötig.",
  },
  {
    id: "change-response",
    group: "coordination",
    question: "Kann ich eine bereits gesendete Antwort ändern?",
    answer:
      "Wenn die Anfrage noch offen für Änderungen ist, öffne sie erneut und sende eine aktualisierte Rückmeldung. Bei einer abgeschlossenen Anfrage nutze den Nachrichtenverlauf und bitte die zuständige Koordination um eine neue Klärung.",
  },
  {
    id: "data-ownership",
    group: "projects",
    question: "Wer kann meine lokalen Ressourcen sehen?",
    answer:
      "Lokale Ressourcen gehören zu deinen Projektdaten. Sie werden nicht automatisch mit anderen Projektbeteiligten geteilt. Sichtbar wird nur, was du selbst im vorgesehenen Projektkontext veröffentlichst oder auf eine konkrete Anfrage hin übermittelst.",
  },
  {
    id: "data-offer",
    group: "projects",
    question: "Wann brauche ich ein separates DataOffer?",
    answer:
      "Nur für unabhängige zusätzliche Datenpakete, etwa ein BIM-Modell, ein Logistikkonzept oder ein Dokumentenpaket. Eine normale Leistungsanfrage enthält ihre gezielte Informationsfreigabe selbst und darf nicht von der Annahme eines separaten DataOffers abhängig gemacht werden.",
  },
  {
    id: "technical-problem",
    group: "troubleshooting",
    question: "Was mache ich bei einem technischen Problem?",
    answer:
      "Notiere Projekt, betroffenen Bereich, Zeitpunkt und die genaue Meldung. Lade die Seite einmal neu und prüfe deine Verbindung. Bleibt das Problem bestehen, sende die Angaben über den vorgesehenen Supportkanal oder an die Projektkoordination. Wiederhole eine Antwort nicht mehrfach, wenn der Status bereits aktualisiert wurde.",
  },
];

function matchesQuery(value: string, query: string) {
  return value.toLocaleLowerCase("de-DE").includes(query.trim().toLocaleLowerCase("de-DE"));
}

export default function Help() {
  const [query, setQuery] = useState("");
  const [activeGroup, setActiveGroup] = useState("all");
  const [openFaq, setOpenFaq] = useState<string | null>(null);

  const filteredArticles = useMemo(() => {
    return articles.filter((article) => {
      const inGroup = activeGroup === "all" || article.group === activeGroup;
      const searchable = `${article.title} ${article.summary} ${article.steps.join(" ")} ${article.keywords}`;
      return inGroup && (!query.trim() || matchesQuery(searchable, query));
    });
  }, [activeGroup, query]);

  const filteredFaqs = useMemo(() => {
    return faqs.filter((faq) => {
      const inGroup = activeGroup === "all" || faq.group === activeGroup;
      return inGroup && (!query.trim() || matchesQuery(`${faq.question} ${faq.answer}`, query));
    });
  }, [activeGroup, query]);

  const hasResults = filteredArticles.length > 0 || filteredFaqs.length > 0;

  return (
    <div className="mx-auto max-w-6xl pb-12" data-testid="page-help">
      <section className="relative overflow-hidden rounded-2xl border border-primary/15 bg-card px-5 py-7 shadow-sm sm:px-9 sm:py-9">
        <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full border-[28px] border-accent/15" />
        <div className="pointer-events-none absolute -bottom-28 right-20 h-52 w-52 rounded-full border-[18px] border-primary/10" />
        <div className="relative max-w-3xl">
          <div className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-primary" data-testid="text-help-eyebrow">
            <HelpCircle className="h-4 w-4" />
            Arbeitsleitfaden für Nachunternehmen
          </div>
          <h1 className="max-w-2xl text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Sicher durch die nächste Abstimmung.
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
            Kurze Antworten für die Arbeit im Projekt: von der Einladung über Leistungsanfragen bis zur bestätigten Buchung.
            Suche nach einem Begriff oder springe direkt in ein Thema.
          </p>

          <div className="relative mt-7 max-w-2xl">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-primary" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
               placeholder="Hilfe durchsuchen, z. B. „Leistungsanfrage“"
              aria-label="Hilfe durchsuchen"
              data-testid="input-help-search"
              className="h-14 w-full rounded-xl border border-primary/20 bg-background/90 pl-12 pr-12 text-sm shadow-sm outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/15"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Suche löschen"
                data-testid="button-clear-help-search"
                className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="mt-6 grid max-w-2xl gap-2 sm:grid-cols-2" data-testid="callout-help-separate-decisions">
            <div className="rounded-lg border border-primary/15 bg-primary/5 px-3 py-2.5">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-primary">Schritt 1 · Einladung</p>
              <p className="mt-1 text-xs leading-5 text-foreground/80">Du akzeptierst die Projekt-Policy und wirst ACTIVE-Projektmitglied.</p>
            </div>
            <div className="rounded-lg border border-accent/35 bg-accent/10 px-3 py-2.5">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-primary">Schritt 2 · Leistungsanfrage</p>
              <p className="mt-1 text-xs leading-5 text-foreground/80">Du prüfst die Child-Policy; nur echte Erweiterungen brauchen Zustimmung.</p>
            </div>
          </div>
          <p className="mt-3 flex max-w-2xl items-start gap-2 text-xs leading-5 text-muted-foreground" data-testid="text-help-publication-rule">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            Wichtig: Die Leistungsanfrage gibt genau den erforderlichen Leistungssnapshot frei. Die technische Tractus-X/EDC-Policy transportiert ihn; die fachliche Vererbung von Projekt- zu Leistungs-Policy wird im Construct-X-Modell bewertet.
          </p>
        </div>
      </section>

      <div className="mt-7 grid gap-8 lg:grid-cols-[215px_1fr]">
        <aside className="lg:sticky lg:top-6 lg:self-start" aria-label="Hilfe-Themen">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">Themen</p>
            <span className="font-mono text-[10px] text-muted-foreground/80" data-testid="text-help-result-count">
              {filteredArticles.length + filteredFaqs.length} Treffer
            </span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2 lg:block lg:space-y-1 lg:overflow-visible">
            <button
              type="button"
              onClick={() => setActiveGroup("all")}
              data-testid="button-help-topic-all"
              className={`flex min-w-max items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors lg:w-full ${
                activeGroup === "all"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <BookOpen className="h-4 w-4" />
              Alle Themen
            </button>
            {topicGroups.map((topic) => {
              const Icon = topic.icon;
              return (
                <button
                  key={topic.id}
                  type="button"
                  onClick={() => setActiveGroup(topic.id)}
                  data-testid={`button-help-topic-${topic.id}`}
                  className={`flex min-w-max items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors lg:w-full ${
                    activeGroup === topic.id
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {topic.label}
                </button>
              );
            })}
          </div>

          <div className="mt-6 hidden rounded-xl border border-accent/30 bg-accent/10 p-4 lg:block">
            <LifeBuoy className="h-5 w-5 text-primary" />
            <p className="mt-3 text-sm font-semibold text-foreground">Keine passende Antwort?</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Halte Projekt, Bereich und Zeitpunkt bereit und wende dich an die zuständige Projektkoordination.
            </p>
          </div>
        </aside>

        <main className="min-w-0">
          {!hasResults && (
            <div className="rounded-xl border border-dashed border-border bg-card px-6 py-12 text-center" data-testid="empty-help-results">
              <Search className="mx-auto h-8 w-8 text-muted-foreground/60" />
              <h2 className="mt-4 text-base font-semibold">Keine Treffer für diese Suche</h2>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                Versuche einen kürzeren Begriff oder wähle „Alle Themen“, um den gesamten Leitfaden zu sehen.
              </p>
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setActiveGroup("all");
                }}
                data-testid="button-reset-help-filters"
                className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5"
              >
                Filter zurücksetzen
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          )}

          {filteredArticles.length > 0 && (
            <section aria-labelledby="guide-heading">
              <div className="mb-3 flex items-end justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">Praxisleitfaden</p>
                  <h2 id="guide-heading" className="mt-1 text-xl font-bold tracking-tight">Die wichtigsten Abläufe</h2>
                </div>
                <span className="hidden text-xs text-muted-foreground sm:block">Schritt für Schritt</span>
              </div>
              <div className="space-y-3">
                {filteredArticles.map((article, index) => {
                  const Icon = article.icon;
                  return (
                    <article
                      key={article.id}
                      data-testid={`card-help-article-${article.id}`}
                      className="group rounded-xl border border-border/80 bg-card p-5 shadow-xs transition-transform hover:-translate-y-0.5 hover:shadow-sm sm:p-6"
                    >
                      <div className="flex gap-4">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
                          <Icon className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                            <h3 className="text-base font-bold text-foreground">{article.title}</h3>
                            <span className="font-mono text-[10px] text-muted-foreground/70">0{index + 1}</span>
                          </div>
                          <p className="mt-1 text-sm leading-6 text-muted-foreground">{article.summary}</p>
                          <ol className="mt-4 grid gap-2 sm:grid-cols-3">
                            {article.steps.map((step, stepIndex) => (
                              <li
                                key={step}
                                data-testid={`text-help-step-${article.id}-${stepIndex + 1}`}
                                className="flex gap-2.5 rounded-lg bg-muted/55 p-3 text-xs leading-5 text-foreground/80"
                              >
                                <span className="font-mono text-[10px] font-bold text-primary">{String(stepIndex + 1).padStart(2, "0")}</span>
                                <span>{step}</span>
                              </li>
                            ))}
                          </ol>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          )}

          {filteredFaqs.length > 0 && (
            <section className="mt-10" aria-labelledby="faq-heading">
              <div className="mb-3">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">Schnelle Antworten</p>
                <h2 id="faq-heading" className="mt-1 text-xl font-bold tracking-tight">Häufig geklärt</h2>
              </div>
              <div className="overflow-hidden rounded-xl border border-border/80 bg-card" data-testid="section-help-faqs">
                {filteredFaqs.map((faq, index) => {
                  const isOpen = openFaq === faq.id;
                  return (
                    <div key={faq.id} className={index > 0 ? "border-t border-border/70" : ""}>
                      <button
                        type="button"
                        onClick={() => setOpenFaq(isOpen ? null : faq.id)}
                        aria-expanded={isOpen}
                        data-testid={`button-help-faq-${faq.id}`}
                        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left text-sm font-semibold transition-colors hover:bg-muted/45"
                      >
                        <span>{faq.question}</span>
                        <ChevronDown className={`h-4 w-4 shrink-0 text-primary transition-transform ${isOpen ? "rotate-180" : ""}`} />
                      </button>
                      {isOpen && (
                        <div className="px-5 pb-5 pr-12 text-sm leading-6 text-muted-foreground" data-testid={`text-help-faq-answer-${faq.id}`}>
                          {faq.answer}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section className="mt-10 rounded-xl border border-primary/15 bg-primary px-5 py-5 text-primary-foreground sm:flex sm:items-center sm:justify-between sm:gap-6 sm:px-6">
            <div className="flex gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
              <div>
                <h2 className="text-sm font-bold">Bereit für den nächsten Schritt?</h2>
                <p className="mt-1 text-xs leading-5 text-primary-foreground/75">
                  Öffne direkt deine offenen Rückmeldungen oder prüfe den aktuellen Abstimmungsstand.
                </p>
              </div>
            </div>
            <div className="mt-4 flex shrink-0 gap-2 sm:mt-0">
              <Link
                href="/leistungsanfragen"
                data-testid="link-help-requests"
                className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-xs font-bold text-accent-foreground transition-transform hover:-translate-y-0.5"
              >
                Anfragen öffnen
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
              <Link
                href="/gantt"
                data-testid="link-help-schedule"
                className="inline-flex items-center gap-2 rounded-lg border border-primary-foreground/25 px-3 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary-foreground/10"
              >
                Terminübersicht
              </Link>
            </div>
          </section>
        </main>
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border/70 pt-5 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-2" data-testid="text-help-ownership-note">
          <ShieldCheck className="h-3.5 w-3.5 text-primary" />
          Datenhoheit bleibt beim Herausgeber
        </span>
        <span className="inline-flex items-center gap-2">
          <Inbox className="h-3.5 w-3.5 text-primary" />
          Antworten bleiben im Anfrageverlauf
        </span>
        <span className="inline-flex items-center gap-2">
          <Hammer className="h-3.5 w-3.5 text-primary" />
          Für den Live-Betrieb geschrieben
        </span>
      </div>
    </div>
  );
}