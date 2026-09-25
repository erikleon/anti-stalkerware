import { el } from "./dom.js";
import { ICONS } from "./icons.js";

export type Screen = "triage" | "incident-log" | "vault-export" | "osint" | "support" | "settings" | "destroy" | "onboarding" | "boundaries";

export interface NavItem {
  screen: Screen;
  label: string;
  icon: string;
}

/** Order matches DESIGN.md "App-level navigation": Triage, Incident log, Vault/Export, OSINT, then the support icon, then Settings pinned to the bottom. */
function navItems(osintHasAnyEligible: boolean): NavItem[] {
  return [
    { screen: "triage", label: "Triage", icon: ICONS.triage },
    { screen: "incident-log", label: "Incident log", icon: ICONS.incidentLog },
    { screen: "vault-export", label: "Vault and export", icon: ICONS.vault },
    { screen: "osint", label: "OSINT", icon: osintHasAnyEligible ? ICONS.osintUnlocked : ICONS.osintLocked },
    { screen: "support", label: "Support and resources", icon: ICONS.support },
  ];
}

export function renderNav(current: Screen, osintHasAnyEligible: boolean, navigate: (screen: Screen) => void): HTMLElement {
  const nav = el("nav", { class: "app-nav", "aria-label": "App sections" });
  // Onboarding is reached from Settings (a Connect button on a source row),
  // not its own nav-strip entry — highlight Settings as current while it's open.
  const effectiveCurrent = current === "onboarding" || current === "boundaries" ? "settings" : current;

  for (const item of navItems(osintHasAnyEligible)) {
    const isCurrent = item.screen === effectiveCurrent;
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
    "aria-label": effectiveCurrent === "settings" ? "Settings (current)" : "Settings",
    ...(effectiveCurrent === "settings" ? { "aria-current": "true" } : {}),
  });
  settingsLink.innerHTML = ICONS.settings;
  settingsLink.addEventListener("click", (e) => {
    e.preventDefault();
    navigate("settings");
  });
  nav.append(settingsLink);

  return nav;
}
