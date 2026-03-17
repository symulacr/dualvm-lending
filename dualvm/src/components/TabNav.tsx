export type TabId = "lend-borrow" | "market-data" | "protocol-info";

interface Tab {
  id: TabId;
  label: string;
}

const TABS: Tab[] = [
  { id: "lend-borrow", label: "Lend & Borrow" },
  { id: "market-data", label: "Market Data" },
  { id: "protocol-info", label: "Protocol Info" },
];

interface TabNavProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

/**
 * Top-level tab navigation. Three tabs:
 * - "Lend & Borrow" (default) — write forms + observer
 * - "Market Data" — read layer, recent activity, asset paths
 * - "Protocol Info" — hero, overview, manifest, security, demo flow
 */
export function TabNav({ activeTab, onTabChange }: TabNavProps) {
  return (
    <nav className="tab-nav" role="tablist">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={activeTab === tab.id}
          className={`tab-nav-btn${activeTab === tab.id ? " tab-nav-btn-active" : ""}`}
          onClick={() => onTabChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
