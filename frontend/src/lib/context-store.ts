import { create } from "zustand";

interface OREONContextState {
  activeAssetId: string | null;
  currentPage: string;
  /** Rolling trail of the operator's recent screens/actions (newest last). */
  recentActivity: string[];
  sidebarCollapsed: boolean;
  setActiveAssetId: (id: string | null) => void;
  setCurrentPage: (page: string) => void;
  pushActivity: (label: string) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
}

const MAX_ACTIVITY = 8;

export const useOREONContext = create<OREONContextState>((set) => ({
  activeAssetId: null,
  currentPage: "Command Center",
  recentActivity: [],
  sidebarCollapsed: typeof window !== "undefined" ? localStorage.getItem("oreon-sidebar-collapsed") === "true" : false,
  setActiveAssetId: (id) => set({ activeAssetId: id }),
  setCurrentPage: (page) => set({ currentPage: page }),
  pushActivity: (label) =>
    set((state) => {
      // De-dupe consecutive repeats so the trail stays meaningful.
      if (state.recentActivity[state.recentActivity.length - 1] === label) return state;
      const next = [...state.recentActivity, label].slice(-MAX_ACTIVITY);
      return { recentActivity: next };
    }),
  setSidebarCollapsed: (collapsed) => {
    if (typeof window !== "undefined") {
      localStorage.setItem("oreon-sidebar-collapsed", String(collapsed));
    }
    set({ sidebarCollapsed: collapsed });
  },
}));
