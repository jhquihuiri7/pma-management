"use client";

import { api, apiErrorMessage, requireOkReceipt } from "@/lib/api-client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { Bell } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AppNotification } from "@/types";

function toDateLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("es", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildNotificationHref(notification: AppNotification): string {
  if (!notification.planId) return "/pma/dashboard";
  const params = new URLSearchParams();
  if (notification.planItemId) params.set("itemId", notification.planItemId);
  if (notification.evidenceId) params.set("evidenceId", notification.evidenceId);
  const query = params.toString();
  return `/pma/plans/${notification.planId}${query ? `?${query}` : ""}`;
}

export default function NotificationsBell() {
  const router = useRouter();
  const { user: session} = useAuth();
  const userId = session?.id;
  const adminId = session?.adminId;

  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [pendingReadIds, setPendingReadIds] = useState<Set<string>>(new Set());
  const pendingReadRef = useRef(new Set<string>());
  const fetchInFlightRef = useRef(false);
  const fetchErrorShownRef = useRef(false);

  const unreadCount = useMemo(
    () => notifications.filter((notification) => !notification.readAt).length,
    [notifications]
  );

  const fetchNotifications = useCallback(async () => {
    if (fetchInFlightRef.current) return;
    fetchInFlightRef.current = true;
    try {
      const data = await api.get<AppNotification[]>("/pma/api/notifications?limit=30", {
        cache: "no-store",
      });
      if (Array.isArray(data)) {
        setNotifications((current) => data.map((incoming) => {
          const existing = current.find((notification) => notification.id === incoming.id);
          return existing?.readAt && !incoming.readAt
            ? { ...incoming, readAt: existing.readAt }
            : incoming;
        }));
      }
      fetchErrorShownRef.current = false;
    } catch (error) {
      if (!fetchErrorShownRef.current) {
        fetchErrorShownRef.current = true;
        toast.error(apiErrorMessage(error, "No se pudieron actualizar las notificaciones"));
      }
    } finally {
      fetchInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!userId || !adminId) return;

    // disposed flag is no longer needed without realtime subscription
    let pollId: ReturnType<typeof setInterval> | null = null;

    const stopPolling = () => {
      if (!pollId) return;
      clearInterval(pollId);
      pollId = null;
    };

    const startPolling = () => {
      if (pollId) return;
      pollId = setInterval(() => {
        void fetchNotifications();
      }, 30000);
    };

    // Polling-only: the new backend does not expose realtime subscriptions.
    // 30s cadence keeps the bell reasonably fresh without overloading the API.
    void fetchNotifications();
    startPolling();

    return () => {
      stopPolling();
    };
  }, [fetchNotifications, userId, adminId]);

  const handleNotificationClick = async (notification: AppNotification) => {
    if (notification.readAt) {
      router.push(buildNotificationHref(notification));
      return;
    }

    if (pendingReadRef.current.has(notification.id)) return;
    pendingReadRef.current.add(notification.id);
    setPendingReadIds(new Set(pendingReadRef.current));
    try {
      requireOkReceipt(
        await api.post<unknown>(`/pma/api/notifications/${notification.id}/read`),
        "El servidor no confirmó la lectura de la notificación"
      );
      const now = new Date().toISOString();
      setNotifications((prev) =>
        prev.map((item) => item.id === notification.id ? { ...item, readAt: now } : item)
      );
      router.push(buildNotificationHref(notification));
    } catch (error) {
      toast.error(apiErrorMessage(error, "No se pudo marcar la notificación como leída"));
    } finally {
      pendingReadRef.current.delete(notification.id);
      setPendingReadIds(new Set(pendingReadRef.current));
    }
  };

  if (!session) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-transparent p-0 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Notificaciones"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <Badge className="absolute -right-1 -top-1 h-5 min-w-5 justify-center rounded-full px-1 text-[10px]">
            {unreadCount > 99 ? "99+" : unreadCount}
          </Badge>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-96">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center justify-between">
            <span>Notificaciones</span>
            <span className="text-[10px] text-muted-foreground">
              {unreadCount} sin leer
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {notifications.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            Sin notificaciones
          </div>
        ) : (
          notifications.map((notification) => (
            <DropdownMenuItem
              key={notification.id}
              onClick={() => void handleNotificationClick(notification)}
              disabled={pendingReadIds.has(notification.id)}
              className="flex flex-col items-start gap-1 py-2"
            >
              <div className="flex w-full items-start justify-between gap-2">
                <span className="text-sm font-medium leading-tight">{notification.title}</span>
                {!notification.readAt && (
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-blue-500" />
                )}
              </div>
              <p className="line-clamp-2 text-xs text-muted-foreground">
                {notification.message}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {toDateLabel(notification.createdAt)}
              </p>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
