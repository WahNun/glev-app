"use client";

import { createContext, useContext, useState, ReactNode } from "react";

export interface ParsedFood { name: string; grams: number; }

export interface Entry {
  id: string;
  text: string;
  foods: ParsedFood[];
  createdAt: Date;
}

interface EntriesContextType {
  entries: Entry[];
  addEntry: (text: string, foods: ParsedFood[]) => void;
}

const EntriesContext = createContext<EntriesContextType>({ entries: [], addEntry: () => {} });

export function EntriesProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Entry[]>([]);

  function addEntry(text: string, foods: ParsedFood[]) {
    setEntries(prev => [{ id: crypto.randomUUID(), text, foods, createdAt: new Date() }, ...prev]);
  }

  return <EntriesContext.Provider value={{ entries, addEntry }}>{children}</EntriesContext.Provider>;
}

export const useEntries = () => useContext(EntriesContext);
