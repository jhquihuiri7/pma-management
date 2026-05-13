"use client";

import { apiFetch } from "@/lib/api-client";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  const params = new URLSearchParams();
  if (notification.planItemId) params.set("itemId", notification.planItemId);
  if (notification.evidenceId) params.set("evidenceId", notification.evidenceId);
  const query = params.toString();
  return `/pg/plans/${notification.planId}${query ? `?${query}` : ""}`;
}

export default function NotificationsBellPG() {
  const { user: session} = useAuth();
  const userId = session?.id;
  const adminId = session?.adminId;

  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  const unreadCount = useMemo(
    () => notifications.filter((notification) => !notification.readAt).length,
    [notifications]
  );

  const fetchNotifications = useCallback(async () => {
    const res = await apiFetch("/pg/api/notifications?limit=30", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as AppNotification[];
    if (Array.isArray(data)) {
      setNotifications(data);
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

    void fetchNotifications();

    startPolling();
    return () => {
      stopPolling();
    };
  }, [fetchNotifications, userId, adminId]);

  const handleNotificationClick = async (notification: AppNotification) => {
    const now = new Date().toISOString();
    if (!notification.readAt) {
      setNotifications((prev) =>
        prev.map((item) =>
          item.id === notification.id ? { ...item, readAt: now } : item
        )
      );

      await apiFetch("/pg/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: notification.id }),
      });
    }

    window.location.assign(buildNotificationHref(notification));
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
