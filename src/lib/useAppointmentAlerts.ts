import { useState, useEffect, useCallback, useRef } from 'react';
import { getAppointmentsByDate } from '@/lib/store';
import { formatDateISO, formatTime12 } from '@/lib/dateUtils';
import { playAppointmentChime, sendDesktopNotification } from '@/lib/alerts';
import { Appointment, Profile } from '@/types';

const APPT_ALERT_STORAGE_PREFIX = 'appt-prealert-10m-';
const CHECK_INTERVAL_MS = 30_000;
const TEN_MINUTES_MS = 10 * 60_000;
const ONE_MINUTE_MS = 60_000;

export interface UpcomingAppointmentAlert {
  appointment: Appointment;
  minutesUntil: number;
  triggeredAt: number;
}

function getAlertSignature(appt: Appointment): string {
  return `${appt.appointment_date}T${appt.start_time}`;
}

function hasAlertFired(appt: Appointment): boolean {
  const key = `${APPT_ALERT_STORAGE_PREFIX}${appt.id}`;
  const sig = getAlertSignature(appt);
  try {
    return localStorage.getItem(key) === sig || sessionStorage.getItem(key) === sig;
  } catch {
    return false;
  }
}

function markAlertFired(appt: Appointment): void {
  const key = `${APPT_ALERT_STORAGE_PREFIX}${appt.id}`;
  const sig = getAlertSignature(appt);
  try {
    localStorage.setItem(key, sig);
    sessionStorage.setItem(key, sig);
  } catch {
    // Ignore storage errors
  }
}

function parseAppointmentStartMs(appt: Appointment): number {
  const [year, month, day] = appt.appointment_date.split('-').map(Number);
  const [hour, minute, second = 0] = appt.start_time.split(':').map(Number);
  return new Date(year, month - 1, day, hour, minute, second, 0).getTime();
}

interface UseAppointmentAlertsArgs {
  profile: Profile | null;
  authLoading: boolean;
  dataVersion: number;
}

export function useAppointmentAlerts({ profile, authLoading, dataVersion }: UseAppointmentAlertsArgs) {
  const [alerts, setAlerts] = useState<UpcomingAppointmentAlert[]>([]);
  const inFlightRef = useRef(false);

  const checkAppointments = useCallback(async () => {
    if (!profile || inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const now = new Date();
      const todayISO = formatDateISO(now);
      const nowMs = now.getTime();

      const todaysAppointments = await getAppointmentsByDate(todayISO);

      const newlyTriggered: UpcomingAppointmentAlert[] = [];

      for (const appt of todaysAppointments) {
        if (appt.status !== 'Scheduled') continue;

        const startMs = parseAppointmentStartMs(appt);
        const diffMs = startMs - nowMs;

        // Between 10 minutes and 1 minute before start
        if (diffMs >= ONE_MINUTE_MS && diffMs <= TEN_MINUTES_MS) {
          if (!hasAlertFired(appt)) {
            markAlertFired(appt);
            const minutesUntil = Math.max(1, Math.round(diffMs / 60_000));
            const formattedTime = formatTime12(appt.start_time);

            playAppointmentChime();
            sendDesktopNotification(
              `Upcoming Appointment in 10 min: ${appt.client_name} at ${formattedTime}`,
              {
                body: `${appt.appointment_type} · Starts in ${minutesUntil} min`,
                tag: `appt-prealert-${appt.id}`,
                requireInteraction: true,
              },
            );

            newlyTriggered.push({
              appointment: appt,
              minutesUntil,
              triggeredAt: nowMs,
            });
          }
        }
      }

      setAlerts((prev) => {
        // Keep existing alerts whose appointments are still scheduled and within window (or up to 5 min past start)
        const apptById = new Map(todaysAppointments.map((a) => [a.id, a]));
        const retained = prev
          .filter((item) => {
            const latest = apptById.get(item.appointment.id);
            if (!latest || latest.status !== 'Scheduled') return false;
            const startMs = parseAppointmentStartMs(latest);
            return nowMs - startMs <= 5 * 60_000;
          })
          .map((item) => {
            const latest = apptById.get(item.appointment.id)!;
            const diffMs = parseAppointmentStartMs(latest) - nowMs;
            return {
              ...item,
              appointment: latest,
              minutesUntil: Math.max(0, Math.round(diffMs / 60_000)),
            };
          });

        const existingIds = new Set(retained.map((r) => r.appointment.id));
        const additions = newlyTriggered.filter((n) => !existingIds.has(n.appointment.id));
        return [...retained, ...additions];
      });
    } catch {
      // Best-effort background polling — never disrupt calendar UI
    } finally {
      inFlightRef.current = false;
    }
  }, [profile]);

  useEffect(() => {
    if (authLoading || !profile) {
      setAlerts([]);
      return;
    }

    checkAppointments();
    const interval = window.setInterval(() => {
      checkAppointments();
    }, CHECK_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [authLoading, profile, dataVersion, checkAppointments]);

  const dismissAlert = useCallback((appointmentId: string) => {
    setAlerts((prev) => prev.filter((a) => a.appointment.id !== appointmentId));
  }, []);

  return {
    upcomingAlerts: alerts,
    dismissUpcomingAlert: dismissAlert,
  };
}
