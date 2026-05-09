import { Cron } from "croner";
import type { TaskSchedule } from "./types.js";

const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function getNextRunAt(schedule: TaskSchedule, from = new Date()): Date | null {
  if (schedule.type === "manual") {
    return null;
  }

  if (schedule.type === "once") {
    const runAt = new Date(schedule.runAt);
    return Number.isNaN(runAt.getTime()) || runAt <= from ? null : runAt;
  }

  if (schedule.type === "interval") {
    if (!Number.isFinite(schedule.everyMinutes) || schedule.everyMinutes < 1) {
      throw new Error("Intervalo precisa ser de pelo menos 1 minuto.");
    }

    return new Date(from.getTime() + schedule.everyMinutes * 60_000);
  }

  if (schedule.type === "daily") {
    const [hours, minutes] = parseTime(schedule.time);
    return nextDailyTime(from, hours, minutes);
  }

  if (schedule.type === "weekly") {
    if (!Number.isInteger(schedule.dayOfWeek) || schedule.dayOfWeek < 0 || schedule.dayOfWeek > 6) {
      throw new Error("Dia da semana precisa ficar entre 0 e 6.");
    }

    const [hours, minutes] = parseTime(schedule.time);
    return nextWeeklyTime(from, schedule.dayOfWeek, hours, minutes);
  }

  const job = new Cron(schedule.expression, { paused: true });
  const nextRun = job.nextRun(from);
  job.stop();
  return nextRun ?? null;
}

export function describeSchedule(schedule: TaskSchedule): string {
  if (schedule.type === "manual") return "manual";
  if (schedule.type === "once") return `uma vez em ${schedule.runAt}`;
  if (schedule.type === "interval") return `a cada ${schedule.everyMinutes} min`;
  if (schedule.type === "daily") return `diario as ${schedule.time}`;
  if (schedule.type === "weekly") return `semanal dia ${schedule.dayOfWeek} as ${schedule.time}`;
  return `cron ${schedule.expression}`;
}

function parseTime(time: string): [number, number] {
  const match = time.match(timePattern);

  if (!match) {
    throw new Error("Horario precisa estar no formato HH:mm.");
  }

  return [Number(match[1]), Number(match[2])];
}

function nextDailyTime(from: Date, hours: number, minutes: number): Date {
  const candidate = new Date(from);
  candidate.setHours(hours, minutes, 0, 0);

  if (candidate <= from) {
    candidate.setDate(candidate.getDate() + 1);
  }

  return candidate;
}

function nextWeeklyTime(from: Date, dayOfWeek: number, hours: number, minutes: number): Date {
  const candidate = new Date(from);
  candidate.setHours(hours, minutes, 0, 0);

  const daysAhead = (dayOfWeek - candidate.getDay() + 7) % 7;
  candidate.setDate(candidate.getDate() + daysAhead);

  if (candidate <= from) {
    candidate.setDate(candidate.getDate() + 7);
  }

  return candidate;
}
