import type {
  ActiveTimeoutEntry,
  AntiCheatSettings,
  DetectionLog,
  DetectorConfig,
  PunishmentAction,
  PunishmentThreshold,
  UserTrustDataWithUser,
  WordFilterRule,
} from "./types";

export type TrustEntry = UserTrustDataWithUser & { userId: string };
export type SettingsSection = "general" | "detectors" | "policies";

export interface DetectorFieldDefinition {
  kind: "number" | "list" | "toggle";
  key: string;
  label: string;
  defaultValue?: number;
  min?: number;
  max?: number;
  step?: number;
  wide?: boolean;
  placeholder?: string;
}

export interface DetectorDefinition {
  key: string;
  title: string;
  description: string;
  icon: string;
  fields?: DetectorFieldDefinition[];
}

export interface AntiCheatViewProps {
  guildId: string;
  guildName: string;
  draft: AntiCheatSettings;
  dirty: boolean;
  saving: boolean;
  executing: boolean;
  logs: DetectionLog[];
  trustEntries: TrustEntry[];
  activeTimeouts: ActiveTimeoutEntry[];
  logsLoading: boolean;
  trustLoading: boolean;
  timeoutsLoading: boolean;
  logsError: string | null;
  trustError: string | null;
  timeoutsError: string | null;
  actionError: string | null;
  saveNotice: string | null;
  excludedRolesText: string;
  excludedChannelsText: string;
  detectors: DetectorDefinition[];
  wordFilterRules: WordFilterRule[];
  onBack: () => void;
  onSave: () => void;
  onRefreshLogs: () => void;
  onRefreshTrust: () => void;
  onRefreshTimeouts: () => void;
  onRevokeLogTimeout: (log: DetectionLog) => void;
  onRevokeActiveTimeout: (entry: ActiveTimeoutEntry) => void;
  onResetTrust: (userId: string) => void;
  setExcludedRolesText: (value: string) => void;
  setExcludedChannelsText: (value: string) => void;
  updateDraft: (
    updater: (current: AntiCheatSettings) => AntiCheatSettings,
  ) => void;
  updateDetector: (detectorKey: string, patch: Partial<DetectorConfig>) => void;
  updateDetectorConfig: (
    detectorKey: string,
    field: string,
    value: unknown,
  ) => void;
  updateListDetectorConfig: (
    detectorKey: string,
    field: string,
    value: string,
  ) => void;
  addWordRule: () => void;
  updateWordRule: (ruleId: string, patch: Partial<WordFilterRule>) => void;
  removeWordRule: (ruleId: string) => void;
  addPunishment: () => void;
  updatePunishment: (
    index: number,
    patch: Partial<PunishmentThreshold>,
  ) => void;
  removePunishment: (index: number) => void;
  addAction: (index: number) => void;
  updateAction: (
    thresholdIndex: number,
    actionIndex: number,
    patch: Partial<PunishmentAction>,
  ) => void;
  removeAction: (thresholdIndex: number, actionIndex: number) => void;
}
