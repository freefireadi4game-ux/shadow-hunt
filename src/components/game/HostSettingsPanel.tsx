import { useEffect, useState } from "react";
import { Settings, X } from "lucide-react";

export interface SettingsDraft {
  duration_minutes: number;
  shadow_ping_interval_minutes: number;
  hunter_reveal_interval_minutes: number;
  zone_shrink_interval_minutes: number;
  zone_initial_radius_m: number;
  zone_min_radius_m: number;
  grace_period_minutes: number;
  capture_mode: string;
  capture_confirm_seconds: number;
  max_reveals_per_player: number;
  reconnect_grace_minutes: number;
  fair_start: boolean;
  zone_warning_seconds: number;
}

export const DEFAULT_SETTINGS: SettingsDraft = {
  duration_minutes: 60,
  shadow_ping_interval_minutes: 3,
  hunter_reveal_interval_minutes: 5,
  zone_shrink_interval_minutes: 10,
  zone_initial_radius_m: 400,
  zone_min_radius_m: 60,
  grace_period_minutes: 2,
  capture_mode: "shadow_confirm",
  capture_confirm_seconds: 60,
  max_reveals_per_player: 0,
  reconnect_grace_minutes: 5,
  fair_start: true,
  zone_warning_seconds: 60,
};

/** Normalize whatever the server stored into the editable shape. */
export function normalizeSettings(raw: unknown): SettingsDraft {
  const s = (raw ?? {}) as Record<string, unknown>;
  const num = (k: keyof SettingsDraft, d: number) => {
    const v = Number(s[k as string]);
    return Number.isFinite(v) && v > 0 ? v : d;
  };
  return {
    duration_minutes: num("duration_minutes", 60),
    shadow_ping_interval_minutes: num("shadow_ping_interval_minutes", 3),
    hunter_reveal_interval_minutes: num("hunter_reveal_interval_minutes", 5),
    zone_shrink_interval_minutes: num("zone_shrink_interval_minutes", 10),
    zone_initial_radius_m: num("zone_initial_radius_m", 400),
    zone_min_radius_m: num("zone_min_radius_m", 60),
    grace_period_minutes: num("grace_period_minutes", 2),
    capture_mode: s["capture_mode"] === "host_verify" ? "host_verify" : "shadow_confirm",
    capture_confirm_seconds: num("capture_confirm_seconds", 60),
    max_reveals_per_player: Math.max(0, Number(s["max_reveals_per_player"]) || 0),
    reconnect_grace_minutes: num("reconnect_grace_minutes", 5),
    fair_start: s["fair_start"] !== false,
    zone_warning_seconds: num("zone_warning_seconds", 60),
  };
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
        {label}
      </span>
      {children}
      {hint && <span className="mt-0.5 block text-[10px] text-zinc-600">{hint}</span>}
    </label>
  );
}

const inputCls =
  "w-full mt-1 px-2.5 py-1.5 bg-zinc-950 border border-zinc-700 rounded-lg text-sm text-zinc-100 focus:outline-none focus:border-emerald-500";

export function HostSettingsPanel({
  initial,
  locked,
  onSave,
  saving,
}: {
  initial: SettingsDraft;
  locked: boolean;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
  saving: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<SettingsDraft>(initial);

  useEffect(() => setDraft(initial), [initial]);

  const set = (patch: Partial<SettingsDraft>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-zinc-300">
          <Settings className="w-4 h-4 text-purple-400" /> Match Settings
          {locked && <span className="text-[9px] text-red-400 normal-case">(locked)</span>}
        </span>
        {open ? <X className="w-4 h-4 text-zinc-500" /> : <span className="text-zinc-500 text-xs">Edit</span>}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Duration (min)">
              <input
                type="number" min={5} max={480} value={draft.duration_minutes} disabled={locked}
                onChange={(e) => set({ duration_minutes: Math.max(5, Number(e.target.value) || 5) })}
                className={inputCls}
              />
            </Field>
            <Field label="Grace period (min)">
              <input
                type="number" min={0} max={15} value={draft.grace_period_minutes} disabled={locked}
                onChange={(e) => set({ grace_period_minutes: Math.max(0, Number(e.target.value) || 0) })}
                className={inputCls}
              />
            </Field>
            <Field label="Shadow ping every (min)">
              <input
                type="number" min={1} max={30} value={draft.shadow_ping_interval_minutes} disabled={locked}
                onChange={(e) => set({ shadow_ping_interval_minutes: Math.max(1, Number(e.target.value) || 1) })}
                className={inputCls}
              />
            </Field>
            <Field label="Hunter reveal every (min)">
              <input
                type="number" min={1} max={30} value={draft.hunter_reveal_interval_minutes} disabled={locked}
                onChange={(e) => set({ hunter_reveal_interval_minutes: Math.max(1, Number(e.target.value) || 1) })}
                className={inputCls}
              />
            </Field>
            <Field label="Zone shrinks every (min)">
              <input
                type="number" min={1} max={60} value={draft.zone_shrink_interval_minutes} disabled={locked}
                onChange={(e) => set({ zone_shrink_interval_minutes: Math.max(1, Number(e.target.value) || 1) })}
                className={inputCls}
              />
            </Field>
            <Field label="Zone warning (s before)">
              <input
                type="number" min={10} max={300} value={draft.zone_warning_seconds} disabled={locked}
                onChange={(e) => set({ zone_warning_seconds: Math.max(10, Number(e.target.value) || 10) })}
                className={inputCls}
              />
            </Field>
            <Field label="Initial radius (m)">
              <input
                type="number" min={50} max={5000} value={draft.zone_initial_radius_m} disabled={locked}
                onChange={(e) => set({ zone_initial_radius_m: Math.max(50, Number(e.target.value) || 50) })}
                className={inputCls}
              />
            </Field>
            <Field label="Minimum radius (m)">
              <input
                type="number" min={10} max={2000} value={draft.zone_min_radius_m} disabled={locked}
                onChange={(e) =>
                  set({ zone_min_radius_m: Math.min(draft.zone_initial_radius_m, Math.max(10, Number(e.target.value) || 10)) })
                }
                className={inputCls}
              />
            </Field>
            <Field label="Capture confirm timeout (s)">
              <input
                type="number" min={15} max={600} value={draft.capture_confirm_seconds} disabled={locked}
                onChange={(e) => set({ capture_confirm_seconds: Math.max(15, Number(e.target.value) || 15) })}
                className={inputCls}
              />
            </Field>
            <Field label="Reconnect grace (min)">
              <input
                type="number" min={1} max={30} value={draft.reconnect_grace_minutes} disabled={locked}
                onChange={(e) => set({ reconnect_grace_minutes: Math.max(1, Number(e.target.value) || 1) })}
                className={inputCls}
              />
            </Field>
          </div>

          <Field label="Capture confirmation" hint="Who verifies a FOUND report">
            <select
              value={draft.capture_mode} disabled={locked}
              onChange={(e) => set({ capture_mode: e.target.value })}
              className={inputCls}
            >
              <option value="shadow_confirm">Shadow confirms / disputes</option>
              <option value="host_verify">Host verifies</option>
            </select>
          </Field>

          <Field label="Max reveals per player" hint="0 = unlimited">
            <input
              type="number" min={0} max={200} value={draft.max_reveals_per_player} disabled={locked}
              onChange={(e) => set({ max_reveals_per_player: Math.max(0, Number(e.target.value) || 0) })}
              className={inputCls}
            />
          </Field>

          <button
            onClick={async () => {
              await onSave({ ...draft });
              setOpen(false);
            }}
            disabled={saving || locked}
            className="w-full py-2.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white font-bold rounded-xl text-xs uppercase tracking-wider"
          >
            {saving ? "Saving..." : "Save Settings"}
          </button>
        </div>
      )}
    </div>
  );
}
