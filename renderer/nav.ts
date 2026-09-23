import { el } from "./dom.js";
import { ICONS } from "./icons.js";

export type Screen = "triage" | "vault-export" | "osint" | "support" | "settings" | "destroy";

export interface NavItem {
  screen: Screen;
  label: string;
  icon: string;
}

/** Order matches DESIGN.md "App-level navigation": Triage, Vault/Export, OSINT, then the support icon added for TODOS item 5, then Settings pinned to the bottom. */
function navItems(osintHasAnyEligible: boolean): NavItem[] {
  return [
    { screen: "triage", label: "Triage", icon: ICONS.triage },
    { screen: "vault-export", label: "Vault and export", icon: ICONS.vault },
    { screen: "osint", label: "OSINT", icon: osintHasAnyEligible ? ICONS.osintUnlocked : ICONS.osintLocked },
    { screen: "support", label: "Support and resources", icon: ICONS.support },
  ];
}

export function renderNav(current: Screen, osintHasAnyEligible: boolean, navigate: (screen: Screen) => void): HTMLElement {
  const nav = el("nav", { class: "app-nav", "aria-label": "App sections" });

  for (const item of navItems(osintHasAnyEligible)) {
    const isCurrent = item.screen === current;
    const link = el("a", {
      href: "#",
      class: "nav-icon",
      "aria-label": isCurrent ? `${item.label} (current)` : item.label,
      ...(isCurrent ? { "aria-current": "true" } : {}),
    });
    link.innerHTML = item.icon;
    link.addEventListener("click", (e) => {
      e.preventDefault();
      navigate(item.screen);
    });
    nav.append(link);
  }

  const settingsLink = el("a", {
    href: "#",
    class: "nav-icon nav-icon--bottom",
    "aria-label": current === "settings" ? "Settings (current)" : "Settings",
    ...(current === "settings" ? { "aria-current": "true" } : {}),
  });
  settingsLink.innerHTML = ICONS.settings;
  settingsLink.addEventListener("click", (e) => {
    e.preventDefault();
    navigate("settings");
  });
  nav.append(settingsLink);

  return nav;
}
