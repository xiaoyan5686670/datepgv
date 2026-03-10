import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function extractSQL(raw: string): string {
  const match = raw.match(/```(?:sql|hive|postgresql|postgres)?\s*\n?([\s\S]*?)```/i);
  return match ? match[1].trim() : raw.trim();
}
