import { contextBridge, ipcRenderer } from "electron";
import type { AntistalkerApi } from "./api";

// Every function here is a thin call to ipcRenderer.invoke against a
// channel handlers.ts registers — nothing here does any work itself, and
// nothing Node-specific (fs, child_process, require of app code) is
// exposed. That keeps contextIsolation/nodeIntegration:false in
// main/index.ts meaningful: a compromised renderer only gets this exact
// surface, not the ability to reach arbitrary main-process APIs.
const api: AntistalkerApi = {
  vault: {
    exists: () => ipcRenderer.invoke("vault:exists"),
    initialize: (passphrase) => ipcRenderer.invoke("vault:initialize", passphrase),
    unlock: (passphrase) => ipcRenderer.invoke("vault:unlock", passphrase),
    lock: () => ipcRenderer.invoke("vault:lock"),
    isUnlocked: () => ipcRenderer.invoke("vault:isUnlocked"),
    onLocked: (callback) => {
      const listener = () => callback();
      ipcRenderer.on("vault:locked", listener);
      return () => ipcRenderer.removeListener("vault:locked", listener);
    },
  },
  support: {
    hotkeyStatus: () => ipcRenderer.invoke("support:hotkeyStatus"),
  },
  triage: {
    listRows: (bucket) => ipcRenderer.invoke("triage:listRows", bucket),
    counts: () => ipcRenderer.invoke("triage:counts"),
    listMessages: (threadId) => ipcRenderer.invoke("triage:listMessages", threadId),
    setReviewed: (messageId, reviewed) => ipcRenderer.invoke("triage:setReviewed", messageId, reviewed),
    setHidden: (messageId, hidden) => ipcRenderer.invoke("triage:setHidden", messageId, hidden),
  },
  osint: {
    eligibleSenders: () => ipcRenderer.invoke("osint:eligibleSenders"),
    rank: (sender) => ipcRenderer.invoke("osint:rank", sender),
  },
  vaultExport: {
    listAll: () => ipcRenderer.invoke("vaultExport:listAll"),
    disclosureText: () => ipcRenderer.invoke("vaultExport:disclosureText"),
    exportToFile: () => ipcRenderer.invoke("vaultExport:exportToFile"),
    history: () => ipcRenderer.invoke("vaultExport:history"),
  },
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    setToastOnTriageAction: (value) => ipcRenderer.invoke("settings:setToastOnTriageAction", value),
    setAutoLockMinutes: (value) => ipcRenderer.invoke("settings:setAutoLockMinutes", value),
    listSources: () => ipcRenderer.invoke("settings:listSources"),
  },
  destroy: {
    disclosureText: () => ipcRenderer.invoke("destroy:disclosureText"),
    confirmationPhrase: () => ipcRenderer.invoke("destroy:confirmationPhrase"),
    confirm: (typedPhrase) => ipcRenderer.invoke("destroy:confirm", typedPhrase),
  },
  onboarding: {
    pickFile: () => ipcRenderer.invoke("onboarding:pickFile"),
    sweepImessage: (dbPath) => ipcRenderer.invoke("onboarding:sweepImessage", dbPath),
    sweepAndroidSms: (exportFilePath) => ipcRenderer.invoke("onboarding:sweepAndroidSms", exportFilePath),
    sweepImap: (connection) => ipcRenderer.invoke("onboarding:sweepImap", connection),
    connectImessage: (dbPath, selectedIdentifiers) => ipcRenderer.invoke("onboarding:connectImessage", dbPath, selectedIdentifiers),
    connectAndroidSms: (exportFilePath, selectedIdentifiers) =>
      ipcRenderer.invoke("onboarding:connectAndroidSms", exportFilePath, selectedIdentifiers),
    connectImap: (connection, selectedIdentifiers) => ipcRenderer.invoke("onboarding:connectImap", connection, selectedIdentifiers),
    syncNow: (source) => ipcRenderer.invoke("onboarding:syncNow", source),
    disconnect: (source) => ipcRenderer.invoke("onboarding:disconnect", source),
  },
  userContext: {
    listBoundaries: () => ipcRenderer.invoke("userContext:listBoundaries"),
    addBoundary: (description, setAt, appliesToSender) => ipcRenderer.invoke("userContext:addBoundary", description, setAt, appliesToSender),
    removeBoundary: (id) => ipcRenderer.invoke("userContext:removeBoundary", id),
    listTaggedPhrases: () => ipcRenderer.invoke("userContext:listTaggedPhrases"),
    addTaggedPhrase: (phrase, note) => ipcRenderer.invoke("userContext:addTaggedPhrase", phrase, note),
    removeTaggedPhrase: (id) => ipcRenderer.invoke("userContext:removeTaggedPhrase", id),
  },
};

contextBridge.exposeInMainWorld("antistalker", api);
