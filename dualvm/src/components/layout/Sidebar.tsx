import { extractNumeric } from "../../lib/format";
import type { ObserverSnapshot } from "../../lib/readModel/types";
import { perf } from "../../lib/perf";

export type FormId = "deposit-collateral" | "supply-liquidity" | "borrow" | "repay" | "withdraw-collateral" | "liquidate";

interface SidebarProps {
  active: FormId;
  onSelect: (id: FormId) => void;
  observer: ObserverSnapshot | null;
  isOpen: boolean;
}

interface NavItem { id: FormId; label: string; }

const GROUP_A: NavItem[] = [
  { id: "deposit-collateral", label: "Deposit collateral" },
  { id: "supply-liquidity", label: "Supply liquidity" },
];

const GROUP_B: NavItem[] = [
  { id: "borrow", label: "Borrow" },
  { id: "repay", label: "Repay" },
  { id: "withdraw-collateral", label: "Withdraw collateral" },
];

const GROUP_C: NavItem[] = [
  { id: "liquidate", label: "Liquidate" },
];

function getSubLabel(id: FormId, obs: ObserverSnapshot | null): { text: string; color: string } | null {
  if (!obs) return null;

  if (id === "borrow") {
    const availNum = extractNumeric(obs.availableToBorrow, "dash");
    if (availNum && availNum !== "0" && availNum !== "0.00") {
      return { text: `↑ ${obs.availableToBorrow} available`, color: "var(--c-success)" };
    }
    return { text: "Requires collateral", color: "var(--c-text-tertiary)" };
  }

  if (id === "repay") {
    const debtNum = extractNumeric(obs.currentDebt, "dash");
    if (debtNum && debtNum !== "0" && debtNum !== "0.00") {
      return { text: `${obs.currentDebt} outstanding`, color: "var(--c-warning)" };
    }
    return null;
  }

  if (id === "withdraw-collateral") {
    if (obs.healthFactorNumeric !== null && obs.healthFactorNumeric < 1.5) {
      return { text: "⚠ Low health factor", color: "var(--c-warning)" };
    }
    return null;
  }

  return null;
}

export function Sidebar({ active, onSelect, observer, isOpen }: SidebarProps) {
  function handleClick(id: FormId) {
    perf.ui.transition("Sidebar", active, id);
    onSelect(id);
  }

  function renderItem(item: NavItem) {
    const subLabel = getSubLabel(item.id, observer);
    return (
      <div key={item.id}>
        <div
          className={`sidebar-item${item.id === active ? " active" : ""}`}
          onClick={() => handleClick(item.id)}
        >
          {item.label}
        </div>
        {subLabel && (
          <div className="sidebar-sub-label" style={{ color: subLabel.color }}>
            {subLabel.text}
          </div>
        )}
      </div>
    );
  }

  return (
    <nav className={`sidebar${!isOpen ? " sidebar-collapsed" : ""}`}>
      <div className="section-eyebrow" style={{ padding: "0 16px 10px" }}>Actions</div>
      {GROUP_A.map(renderItem)}
      <div className="sidebar-sep" />
      {GROUP_B.map(renderItem)}
      <div className="sidebar-sep" />
      {GROUP_C.map(renderItem)}
    </nav>
  );
}
