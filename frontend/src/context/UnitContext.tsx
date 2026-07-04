import { createContext, useContext, useState } from "react";

export type Unit = "kg" | "lb";

const KG_TO_LB = 2.20462;

interface UnitContextValue {
  unit: Unit;
  setUnit: (u: Unit) => void;
  toDisplay: (kg: number) => number;
  fromDisplay: (val: number) => number;
  unitLabel: string;
}

const UnitContext = createContext<UnitContextValue>({
  unit: "kg",
  setUnit: () => {},
  toDisplay: (kg) => kg,
  fromDisplay: (v) => v,
  unitLabel: "kg",
});

export function UnitProvider({ children }: { children: React.ReactNode }) {
  const [unit, setUnitState] = useState<Unit>(() => {
    return (localStorage.getItem("forja_unit") as Unit) || "kg";
  });

  function setUnit(u: Unit) {
    localStorage.setItem("forja_unit", u);
    setUnitState(u);
  }

  function toDisplay(kg: number): number {
    if (unit === "lb") return Math.round(kg * KG_TO_LB * 10) / 10;
    return kg;
  }

  function fromDisplay(val: number): number {
    if (unit === "lb") return val / KG_TO_LB;
    return val;
  }

  return (
    <UnitContext.Provider value={{ unit, setUnit, toDisplay, fromDisplay, unitLabel: unit }}>
      {children}
    </UnitContext.Provider>
  );
}

export function useUnit() {
  return useContext(UnitContext);
}
