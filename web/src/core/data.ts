// Loads the bundled reference tables (peaks, cities, airports, airlines…).
// The CSVs are the same files the Python package uses (src/windowseat/data),
// copied into public/data at build time.

export type TextLoader = (name: string) => Promise<string>;

let loader: TextLoader = async (name) => {
  const r = await fetch(`data/${name}`);
  if (!r.ok) throw new Error(`Couldn't load data/${name} (${r.status})`);
  return r.text();
};

export function setDataLoader(fn: TextLoader) { loader = fn; cache.clear(); }

const cache = new Map<string, Promise<Record<string, string>[]>>();

/** Parse a CSV file (with quoted fields) into objects keyed by the header row. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.replace(/^﻿/, "").trim());
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

export function table(name: string): Promise<Record<string, string>[]> {
  if (!cache.has(name)) cache.set(name, loader(name).then(parseCsv));
  return cache.get(name)!;
}
