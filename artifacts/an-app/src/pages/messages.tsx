import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  AlertTriangle,
  Bell,
  Check,
  CheckCircle2,
  ChevronRight,
  FileText,
  Inbox,
  Loader2,
  MailOpen,
  RefreshCw,
  XCircle,
} from "lucide-react";
import {
  useListInboxMessages,
  useMarkInboxMessageRead,
  type InboxMessageItem,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type MessageFilter = "all" | "unread";

const MESSAGE_LABELS: Record<string, string> = {
  TAKT_REQUEST_NOTIFICATION: "Neue Leistungsanfrage",
  TAKT_REQUEST_REVISED: "Leistungsanfrage aktualisiert",
  TAKT_REQUEST_CANCELLED: "Leistungsanfrage zurückgezogen",
  TAKT_DETAILS_RETRIEVED: "Details abgerufen",
  TAKT_RESPONSE_SUBMITTED: "Antwort übermittelt",
  TAKT_RESPONSE_ACCEPTED: "Antwort angenommen",
  TAKT_RESPONSE_REVISION_REQUESTED: "Änderung angefragt",
  TAKT_REQUEST_EXPIRED: "Anfrage abgelaufen",
  TAKT_REQUEST_REMINDER: "Erinnerung",
  DATA_OFFER_PUBLISHED: "Neue Leistungsfreigabe",
  PROJECT_INVITATION: "Projekteinladung",
  PROJECT_INVITATION_RESPONSE: "Einladung beantwortet",
};

const MESSAGE_STYLES: Record<string, { icon: typeof Bell; color: string; background: string }> = {
  TAKT_REQUEST_CANCELLED: {
    icon: XCircle,
    color: "text-destructive",
    background: "bg-destructive/10",
  },
  TAKT_REQUEST_EXPIRED: {
    icon: AlertTriangle,
    color: "text-orange-600 dark:text-orange-400",
    background: "bg-orange-500/10",
  },
  TAKT_RESPONSE_ACCEPTED: {
    icon: CheckCircle2,
    color: "text-emerald-600 dark:text-emerald-400",
    background: "bg-emerald-500/10",
  },
  TAKT_REQUEST_REMINDER: {
    icon: Bell,
    color: "text-orange-600 dark:text-orange-400",
    background: "bg-orange-500/10",
  },
};

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function messageTitle(message: InboxMessageItem): string {
  const payload = message.payload;
  return (
    stringValue(payload.subject) ??
    stringValue(payload.title) ??
    stringValue(payload.leistungReference) ??
    MESSAGE_LABELS[message.messageType] ??
    "Nachricht"
  );
}

function messageSummary(message: InboxMessageItem): string | undefined {
  const payload = message.payload;
  return stringValue(payload.message) ?? stringValue(payload.comment);
}

function messageLink(message: InboxMessageItem): string | undefined {
  const deepLink = stringValue(message.payload.deepLink);
  if (deepLink?.startsWith("/")) return deepLink;
  const requestId = stringValue(message.payload.taktRequestId) ?? stringValue(message.payload.leistungsanfrageId);
  return requestId ? `/leistungsanfragen/${requestId}` : undefined;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unbekannt";
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function MessageRow({
  message,
  onRead,
  isReading,
}: {
  message: InboxMessageItem;
  onRead: (messageId: string) => void;
  isReading: boolean;
}) {
  const isUnread = !message.readAt && message.status !== "READ";
  const style = MESSAGE_STYLES[message.messageType] ?? {
    icon: FileText,
    color: "text-primary",
    background: "bg-primary/10",
  };
  const Icon = style.icon;
  const href = messageLink(message);

  return (
    <Card className={isUnread ? "border-primary/40 shadow-sm" : "border-border/70"}>
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${style.background} ${style.color}`}>
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                {MESSAGE_LABELS[message.messageType] ?? "Nachricht"}
              </span>
              {isUnread && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                  Ungelesen
                </span>
              )}
            </div>
            <h2 className="mt-1 break-words text-sm font-semibold text-foreground">{messageTitle(message)}</h2>
            {messageSummary(message) && (
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                {messageSummary(message)}
              </p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Erhalten am {formatDate(message.receivedAt)}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {isUnread && (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-xs"
                onClick={() => onRead(message.messageId)}
                disabled={isReading}
                title="Als gelesen markieren"
              >
                {isReading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                <span className="hidden sm:inline">Gelesen</span>
              </Button>
            )}
            {href && (
              <Button asChild variant="outline" size="sm" className="gap-1.5">
                <Link href={href}>
                  <span className="hidden sm:inline">Öffnen</span>
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function MessagesPage() {
  const [filter, setFilter] = useState<MessageFilter>("all");
  const { data: messages, isLoading, isError, refetch, isFetching } = useListInboxMessages(undefined, {
    query: { queryKey: ["/api/messages/inbox"], refetchInterval: 60_000 },
  });
  const markRead = useMarkInboxMessageRead();
  const visibleMessages = useMemo(
    () => (messages ?? []).filter((message) => filter === "all" || (!message.readAt && message.status !== "READ")),
    [filter, messages],
  );
  const unreadCount = (messages ?? []).filter((message) => !message.readAt && message.status !== "READ").length;

  const handleRead = (messageId: string) => {
    markRead.mutate({ messageId }, {
      onSuccess: () => void refetch(),
    });
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 animate-in fade-in duration-300">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-lg bg-primary/10 p-2.5 text-primary">
            <Inbox className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Nachrichten</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Benachrichtigungen aus der geschützten Koordination und dem Datenraum.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" className="gap-2 self-start" onClick={() => void refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          Aktualisieren
        </Button>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b pb-3">
        <Button
          variant={filter === "all" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setFilter("all")}
        >
          Alle {messages ? `(${messages.length})` : ""}
        </Button>
        <Button
          variant={filter === "unread" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setFilter("unread")}
        >
          <MailOpen className="mr-1.5 h-4 w-4" />
          Ungelesen {unreadCount ? `(${unreadCount})` : ""}
        </Button>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((item) => <Skeleton key={item} className="h-28 w-full rounded-lg" />)}
        </div>
      )}

      {isError && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <AlertTriangle className="h-8 w-8 text-destructive" />
            <div>
              <p className="font-medium">Nachrichten konnten nicht geladen werden.</p>
              <p className="mt-1 text-sm text-muted-foreground">Bitte versuchen Sie es erneut.</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>Erneut versuchen</Button>
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && visibleMessages.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center p-12 text-center">
            <Inbox className="mb-4 h-10 w-10 text-muted-foreground/40" />
            <h2 className="font-medium">
              {filter === "unread" ? "Keine ungelesenen Nachrichten" : "Noch keine Nachrichten"}
            </h2>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Neue Koordinationsereignisse erscheinen hier, ohne interne Planungs- oder Ressourcendaten offenzulegen.
            </p>
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && visibleMessages.length > 0 && (
        <div className="space-y-3">
          {visibleMessages.map((message) => (
            <MessageRow
              key={message.id}
              message={message}
              onRead={handleRead}
              isReading={markRead.isPending && markRead.variables?.messageId === message.messageId}
            />
          ))}
        </div>
      )}
    </div>
  );
}