import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { useGeolocation } from "@/hooks/useGeolocation";
import {
  ClientOnlyTacticalMap as TacticalMap
} from "@/components/game/ClientOnlyTacticalMap";
import {
  HostSettingsPanel,
  DEFAULT_SETTINGS,
  normalizeSettings,
} from "@/components/game/HostSettingsPanel";
import { ResultsScreen } from "@/components/game/ResultsScreen";
import { fmtCountdown, haversineM } from "@/lib/gameTime";
import {
  ShieldAlert,
  Crosshair,
  LogOut,
  Play,
  Pause,
  RotateCcw,
  AlertTriangle,
  Radio,
  Timer,
  Navigation,
  CheckCircle2,
  XCircle,
  Download,
  Users,
  History,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Shadow Hunt - Tactical IRL Manhunt" },
      {
        name: "description",
        content: "Real-life multiplayer GPS hunter-vs-runner manhunt. Create a room, share the code, and hunt.",
      },
      { property: "og:title", content: "Shadow Hunt - Tactical IRL Manhunt" },
      {
        property: "og:description",
        content: "Real-life multiplayer GPS hunter-vs-runner manhunt with safe zones, pings and captures.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "manifest", href: "/manifest.webmanifest" }],
  }),
  component: ShadowHuntApp,
});

const MINUTE_MS = 60_000;

export default function ShadowHuntApp() {
  // ---------- Auth ----------
  const [sessionUser, setSessionUser] = useState<any>(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // ---------- Match / lobby ----------
  const [matchId, setMatchId] = useState<string | null>(null);
  const [matchData, setMatchData] = useState<any>(null);
  const [participants, setParticipants] = useState<any[]>([]);
  const [joinCode, setJoinCode] = useState("");
  const [myParticipant, setMyParticipant] = useState<any>(null);
  const [reveals, setReveals] = useState<any[]>([]);
  const [activeCapture, setActiveCapture] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [savingSettings, setSavingSettings] = useState(false);
  const [rematchLoading, setRematchLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [installEvt, setInstallEvt] = useState<any>(null);

  // Server clock offset (ms): serverNow - clientNow, from tick responses.
  const [serverOffset, setServerOffset] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());

  
const geo = useGeolocation(
  Boolean(
    matchId &&
    matchData &&
    ["lobby", "active", "paused"].includes(matchData.status)
  )
);
  

  const roleRef = useRef<string | null>(null);
  roleRef.current = myParticipant?.role ?? null;

  const notify = useCallback((msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice((n) => (n === msg ? null : n)), 7000);
  }, []);

  // 1. Session + service worker + install prompt
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSessionUser(data.session?.user ?? null));
    const { data: authListener } = supabase.auth.onAuthStateChange((_e, session) => {
      setSessionUser(session?.user ?? null);
    });
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    const onInstall = (e: Event) => {
      e.preventDefault();
      setInstallEvt(e);
    };
    window.addEventListener("beforeinstallprompt", onInstall);
    return () => {
      authListener.subscription.unsubscribe();
      window.removeEventListener("beforeinstallprompt", onInstall);
    };
  }, []);

  // 2. One-second heartbeat for countdowns
  useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  // 3. Fetch match, participants, reveals
  const refreshMatch = useCallback(async (id: string) => {
    const { data: m } = await supabase.from("matches").select("*").eq("id", id).maybeSingle();
    if (m) setMatchData(m);

    const { data: parts, error: partsErr } = await supabase
      .from("match_participants")
      
.select("*, profiles!fk_participants_profile(username)")
      
      .eq("match_id", id);
    if (parts) {
      setParticipants(parts);
    } else if (partsErr) {
      console.error("participants fetch failed", partsErr);
    }

    const { data: revs } = await supabase
      .from("location_reveals")
      .select("*")
      .eq("match_id", id)
      .order("revealed_at", { ascending: false })
      .limit(20);
    if (revs) setReveals(revs);
  }, []);

  // Keep "my participant" in sync with the session user
  const userId = sessionUser?.id ?? null;
  useEffect(() => {
    if (!userId) return;
    setMyParticipant(participants.find((p) => p.user_id === userId) ?? null);
  }, [participants, userId]);

  // 4. Realtime subscription
  useEffect(() => {
    if (!matchId) return;
    void refreshMatch(matchId);

    const channel = supabase
      .channel(`match:${matchId}:${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "matches", filter: `id=eq.${matchId}` },
        () => refreshMatch(matchId)
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "match_participants", filter: `match_id=eq.${matchId}` },
        () => refreshMatch(matchId)
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "location_reveals", filter: `match_id=eq.${matchId}` },
        (payload: any) => {
          const kind = payload?.new?.kind;
          if (kind === "shadow_ping" && roleRef.current === "hunter") notify("New Shadow ping on your map!");
          if (kind === "hunter_reveal" && roleRef.current === "shadow") notify("Hunter positions revealed!");
          refreshMatch(matchId);
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "capture_reports", filter: `match_id=eq.${matchId}` },
        (payload: any) => {
          const row = payload?.new;
          if (row && row.target_id === userId && row.status === "pending") {
            setActiveCapture(row);
            notify("A Hunter says they found you — confirm or dispute!");
          } else if (row && row.reporter_id === userId && row.status === "pending") {
            notify("FOUND report sent — waiting for confirmation.");
          } else if (row && row.status !== "pending") {
            setActiveCapture(null);
          }
          refreshMatch(matchId);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [matchId, refreshMatch, notify, userId]);

  // 5. Tick loop + position submission while the match runs
  useEffect(() => {
    if (!matchId || !matchData || !["active", "paused"].includes(matchData.status)) return;

    const interval = window.setInterval(async () => {
      try {
        const { data, error } = await supabase.rpc("tick_match", { _match: matchId });
        if (error) throw error;
        const res = data as { events?: any[]; server_now?: string };
        if (res?.server_now) {
          setServerOffset(new Date(res.server_now).getTime() - Date.now());
        }
        for (const ev of res?.events ?? []) {
          if (ev.type === "zone_shrunk") notify(`Safe zone shrunk to ${Math.round(ev.radius_m)}m!`);
          if (ev.type === "capture_confirmed") notify("A Shadow was captured!");
          if (ev.type === "player_timed_out") notify("A player dropped out (disconnected too long).");
        }
      } catch (e) {
        console.error("Tick error", e);
      }

      if (geo.lat != null && geo.lng != null) {
        try {
          await supabase.rpc("submit_position", {
            _match: matchId,
            _lat: geo.lat,
            _lng: geo.lng,
            _accuracy: geo.accuracy || 20,
            _speed: geo.speed || 0,
            _heading: geo.heading || 0,
          });
        } catch (e) {
          console.error("Position submission error", e);
        }
      }
    }, 4000);

    return () => window.clearInterval(interval);
  }, [matchId, matchData?.status, geo.lat, geo.lng, geo.accuracy, geo.speed, geo.heading, notify]);

  // 6. Match history on the home screen
  useEffect(() => {
    if (!sessionUser || matchId) return;
    supabase
      .from("match_participants")
      .select(
        "id, role, status, captures_made, joined_at, matches:match_id(code, status, winner, completed_at)"
      )
      .eq("user_id", sessionUser.id)
      .order("joined_at", { ascending: false })
      .limit(6)
      .then(({ data }) => setHistory(data ?? []));
  }, [sessionUser, matchId, matchData?.status]);

  // ---------- Derived countdowns ----------
  const settings = useMemo(() => normalizeSettings(matchData?.settings), [matchData?.settings]);

  const at = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : null);
  const serverNow = nowMs + serverOffset;

  const matchLeft = useMemo(() => {
    const ends = at(matchData?.ends_at);
    if (ends == null) return null;
    return Math.max(0, ends - serverNow);
  }, [matchData?.ends_at, serverNow]);

  const graceLeft = useMemo(() => {
    const g = at(matchData?.grace_ends_at);
    if (g == null) return null;
    return g - serverNow;
  }, [matchData?.grace_ends_at, serverNow]);

  const nextPingMs = useMemo(() => {
    const last = at(matchData?.shadow_last_ping_at);
    if (last == null) return null;
    return Math.max(0, last + settings.shadow_ping_interval_minutes * MINUTE_MS - serverNow);
  }, [matchData?.shadow_last_ping_at, settings.shadow_ping_interval_minutes, serverNow]);

  const nextRevealMs = useMemo(() => {
    const last = at(matchData?.hunter_last_reveal_at);
    if (last == null) return null;
    return Math.max(0, last + settings.hunter_reveal_interval_minutes * MINUTE_MS - serverNow);
  }, [matchData?.hunter_last_reveal_at, settings.hunter_reveal_interval_minutes, serverNow]);

  const nextShrinkMs = useMemo(() => {
    const last = at(matchData?.zone_last_shrink_at);
    if (last == null) return null;
    return Math.max(0, last + settings.zone_shrink_interval_minutes * MINUTE_MS - serverNow);
  }, [matchData?.zone_last_shrink_at, settings.zone_shrink_interval_minutes, serverNow]);

  const isOutsideZone = useMemo(() => {
    if (geo.lat == null || geo.lng == null) return false;
    if (matchData?.zone_center_lat == null || matchData?.zone_radius_m == null) return false;
    return (
      haversineM(geo.lat, geo.lng, matchData.zone_center_lat, matchData.zone_center_lng) >
      matchData.zone_radius_m
    );
  }, [geo.lat, geo.lng, matchData?.zone_center_lat, matchData?.zone_center_lng, matchData?.zone_radius_m]);

  // ---------- Actions ----------
  const handleCreateMatch = async (settingsOverride?: Record<string, unknown>) => {
    try {
      const { data, error } = await supabase.rpc("create_match", {
        _settings: (settingsOverride ?? { ...DEFAULT_SETTINGS }) as any,
      });
      if (error) throw error;
      const res = data as { id: string; code: string };
      setMatchId(res.id);
    } catch (err: any) {
      notify(err.message || "Failed to create match");
    }
  };

  const handleJoinMatch = async () => {
    if (!joinCode) return;
    try {
      const { data, error } = await supabase.rpc("join_match", { _code: joinCode.trim() });
      if (error) throw error;
      setMatchId(data as string);
      setJoinCode("");
    } catch (err: any) {
      notify(err.message || "Failed to join match");
    }
  };

  const handleStartMatch = async () => {
    if (!matchId) return;
    if (geo.lat == null || geo.lng == null) {
      notify("Waiting for GPS before the safe zone can be placed.");
      return;
    }
    try {
      const { error } = await supabase.rpc("start_match", {
        _match: matchId,
        _center_lat: geo.lat,
        _center_lng: geo.lng,
      });
      if (error) throw error;
      await refreshMatch(matchId);
      notify("Match deployed! Spread out during the grace period.");
    } catch (err: any) {
      notify(err.message || "Failed to start match");
    }
  };

  const handleRandomizeRoles = async () => {
    if (!matchId) return;
    try {
      const { error } = await supabase.rpc("randomize_roles", { _match: matchId });
      if (error) throw error;
      refreshMatch(matchId);
    } catch (err: any) {
      notify(err.message);
    }
  };

  const handleAssignRole = async (targetId: string, role: "hunter" | "shadow") => {
    if (!matchId) return;
    try {
      const { error } = await supabase.rpc("set_participant_role", {
        _match: matchId,
        _target: targetId,
        _role: role,
      });
      if (error) throw error;
      refreshMatch(matchId);
    } catch (err: any) {
      notify(err.message);
    }
  };

  const handleToggleReady = async () => {
    if (!matchId || !myParticipant) return;
    try {
      const { error } = await supabase.rpc("set_ready", {
        _match: matchId,
        _ready: !myParticipant.ready,
      });
      if (error) throw error;
      refreshMatch(matchId);
    } catch (err: any) {
      notify(err.message);
    }
  };

  const handleSaveSettings = async (patch: Record<string, unknown>) => {
    if (!matchId) return;
    setSavingSettings(true);
    try {
      const { error } = await supabase.rpc("update_match_settings", {
        _match: matchId,
        _settings: patch as any,
      });
      if (error) throw error;
      await refreshMatch(matchId);
      notify("Settings updated.");
    } catch (err: any) {
      notify(err.message || "Failed to save settings");
    } finally {
      setSavingSettings(false);
    }
  };

  const handleReportCapture = async (targetId: string) => {
    if (!matchId) return;
    try {
      const { error } = await supabase.rpc("report_capture", { _match: matchId, _target: targetId });
      if (error) throw error;
      notify("FOUND report submitted — waiting for confirmation.");
    } catch (err: any) {
      notify(err.message || "Capture report failed.");
    }
  };

  const handleResolveCapture = async (confirm: boolean) => {
    if (!activeCapture) return;
    try {
      const { error } = await supabase.rpc("resolve_capture", {
        _report: activeCapture.id,
        _confirm: confirm,
      });
      if (error) throw error;
      setActiveCapture(null);
      if (matchId) refreshMatch(matchId);
    } catch (err: any) {
      notify(err.message || "Failed to resolve capture.");
    }
  };

  const handleHostControl = async (fn: "pause_match" | "resume_match" | "abort_match") => {
    if (!matchId) return;
    if (fn === "abort_match" && !window.confirm("End the match for everyone?")) return;
    try {
      const { error } = await supabase.rpc(fn, { _match: matchId });
      if (error) throw error;
      refreshMatch(matchId);
    } catch (err: any) {
      notify(err.message);
    }
  };

  const handleEmergencyExit = async () => {
    if (!matchId) return;
    if (window.confirm("Emergency Stop: leave the match immediately?")) {
      await supabase.rpc("leave_match", { _match: matchId });
      setMatchId(null);
      setMatchData(null);
    }
  };

  const handleRematch = async () => {
    setRematchLoading(true);
    try {
      await handleCreateMatch(matchData?.settings ? { ...matchData.settings } : undefined);
    } finally {
      setRematchLoading(false);
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError(null);
    try {
      if (authMode === "signup") {
        const { error } = await supabase.auth.signUp({ email: authEmail, password: authPassword });
        if (error) throw error;
        notify("Account created! You can now log in.");
        setAuthMode("login");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: authEmail,
          password: authPassword,
        });
        if (error) throw error;
      }
    } catch (err: any) {
      setAuthError(err.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleGoogle = async () => {
    setAuthError(null);
    const res = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
    if (res?.error && !res.redirected) setAuthError(res.error.message ?? "Google sign-in failed");
  };

  // ============================================================
  // 1. Unauthenticated
  // ============================================================
  if (!sessionUser) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col justify-center items-center px-4 py-8">
        <div className="max-w-md w-full bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-2xl">
          <div className="flex items-center justify-center gap-3 mb-6">
            <Radio className="w-8 h-8 text-emerald-400 animate-pulse" />
            <h1 className="text-2xl font-black tracking-widest text-emerald-400 uppercase">Shadow Hunt</h1>
          </div>
          <p className="text-xs text-zinc-400 text-center mb-6">
            IRL tactical multiplayer manhunt with real GPS tracking.
          </p>

          {authError && (
            <div className="bg-red-950/80 border border-red-700 text-red-200 text-xs p-3 rounded-lg mb-4">
              {authError}
            </div>
          )}

          <form onSubmit={handleAuth} className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-zinc-400">Email address</label>
              <input
                type="email"
                required
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                className="w-full mt-1 px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-lg text-sm text-zinc-100 focus:outline-none focus:border-emerald-500"
                placeholder="operative@hunt.com"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-zinc-400">Password</label>
              <input
                type="password"
                required
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                className="w-full mt-1 px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-lg text-sm text-zinc-100 focus:outline-none focus:border-emerald-500"
                placeholder="••••••••"
              />
            </div>
            <button
              type="submit"
              disabled={authLoading}
              className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-600 text-zinc-950 font-bold rounded-lg text-sm transition tracking-wider uppercase mt-2"
            >
              {authLoading ? "Authenticating..." : authMode === "login" ? "Enter warzone" : "Register operative"}
            </button>
          </form>

          <div className="flex items-center gap-3 my-4">
            <div className="h-px flex-1 bg-zinc-800" />
            <span className="text-[10px] text-zinc-600 uppercase">or</span>
            <div className="h-px flex-1 bg-zinc-800" />
          </div>
          <button
            onClick={handleGoogle}
            className="w-full py-2.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-100 font-bold rounded-lg text-sm transition"
          >
            Continue with Google
          </button>

          <div className="mt-4 text-center">
            <button
              onClick={() => setAuthMode(authMode === "login" ? "signup" : "login")}
              className="text-xs text-zinc-400 hover:text-emerald-400 underline"
            >
              {authMode === "login" ? "Need an operative account? Sign up" : "Existing operative? Log in"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================
  // 2. Home (no match selected)
  // ============================================================
  if (!matchId) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 p-4 max-w-lg mx-auto flex flex-col">
        <header className="flex justify-between items-center py-4 border-b border-zinc-800">
          <div>
            <h1 className="text-lg font-black tracking-wider text-emerald-400">SHADOW HUNT</h1>
            <p className="text-xs text-zinc-400">{sessionUser.email}</p>
          </div>
          <button
            onClick={() => supabase.auth.signOut()}
            className="p-2 text-zinc-400 hover:text-red-400 bg-zinc-900 rounded-lg border border-zinc-800"
            aria-label="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </header>

        <main className="my-auto space-y-4 py-6">
          {notice && (
            <div className="bg-zinc-800 border border-emerald-700 text-emerald-300 text-xs p-3 rounded-lg">
              {notice}
            </div>
          )}

          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 text-center space-y-4">
            <Crosshair className="w-12 h-12 text-emerald-400 mx-auto" />
            <h2 className="text-lg font-bold">Start a new hunt</h2>
            <p className="text-xs text-zinc-400">
              Host a room, configure timers and radii, and invite your friends.
            </p>
            <button
              onClick={() => handleCreateMatch()}
              className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold rounded-xl text-sm transition tracking-wider uppercase"
            >
              Create tactical room
            </button>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-3">
            <h2 className="text-sm font-bold text-zinc-300">Join existing room</h2>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="ROOM CODE"
                maxLength={8}
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-xl text-center text-sm font-mono tracking-widest uppercase focus:border-emerald-500 outline-none"
              />
              <button
                onClick={handleJoinMatch}
                disabled={!joinCode}
                className="px-6 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white font-bold rounded-xl text-sm transition"
              >
                Join
              </button>
            </div>
          </div>

          {installEvt && (
            <button
              onClick={async () => {
                installEvt.prompt();
                setInstallEvt(null);
              }}
              className="w-full py-2.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 font-bold rounded-xl text-xs flex items-center justify-center gap-2"
            >
              <Download className="w-4 h-4" /> Install Shadow Hunt on this phone
            </button>
          )}

          {history.length > 0 && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
              <h3 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-zinc-400 px-4 pt-3 pb-2">
                <History className="w-3.5 h-3.5" /> Recent matches
              </h3>
              <div className="divide-y divide-zinc-800/70">
                {history.map((h) => {
                  const m = h.matches;
                  const label =
                    m?.status === "completed"
                      ? m.winner === "hunters"
                        ? "Hunters won"
                        : m.winner === "shadows"
                        ? "Shadows won"
                        : "Ended"
                      : m?.status === "aborted"
                      ? "Aborted"
                      : m?.status === "active"
                      ? "In progress"
                      : "Lobby";
                  return (
                    <div key={h.id} className="flex items-center justify-between px-4 py-2.5">
                      <div>
                        <div className="text-xs font-mono font-bold text-emerald-400">{m?.code}</div>
                        <div className="text-[10px] text-zinc-500 uppercase">{h.role || "unassigned"}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[11px] text-zinc-300">{label}</div>
                        {h.captures_made > 0 && (
                          <div className="text-[10px] text-orange-400">{h.captures_made} captures</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </main>

        <footer className="text-center text-[10px] text-zinc-500 pb-2">
          Always obey local laws. No trespassing. Play responsibly.
        </footer>
      </div>
    );
  }

  // ============================================================
  // 3. Room lobby
  // ============================================================
  
  // Wait for match data after creating or joining a room
  if (!matchData) {
    return (
      <div className="min-h-screen bg-zinc-950 text-emerald-400 flex flex-col items-center justify-center gap-3">
        <div className="w-8 h-8 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
        <p className="text-xs font-mono tracking-widest">
          INITIALIZING TACTICAL ROOM...
        </p>
      </div>
    );
  }
  
  if (matchData?.status === "lobby") {
    const isHost = matchData.host_id === sessionUser.id;
    const allReady = participants.length > 1 && participants.every((p) => p.ready);
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 p-4 max-w-lg mx-auto flex flex-col">
        <div className="flex justify-between items-center py-3 border-b border-zinc-800 mb-4">
          <div>
            <span className="text-xs uppercase text-zinc-400">Lobby code</span>
            <div className="text-2xl font-mono font-black text-emerald-400 tracking-widest">
              {matchData.code}
            </div>
          </div>
          <button
            onClick={() => {
              const code = matchData.code;
              if (navigator.share) {
                navigator.share({ title: "Shadow Hunt", text: `Join my hunt! Room code: ${code}` }).catch(() => {});
              } else {
                navigator.clipboard?.writeText(code).then(() => notify("Room code copied!"));
              }
            }}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl text-xs uppercase"
          >
            Invite
          </button>
        </div>

        {notice && (
          <div className="bg-zinc-800 border border-emerald-700 text-emerald-300 text-xs p-3 rounded-lg mb-3">
            {notice}
          </div>
        )}

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 mb-4">
          <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">
            <Users className="w-3.5 h-3.5 inline mr-1" />
            Operatives joined ({participants.length})
          </h3>
          <div className="space-y-2">
            {participants.map((p) => (
              <div
                key={p.id}
                className="flex justify-between items-center bg-zinc-950 px-3 py-2 rounded-lg border border-zinc-800/80 gap-2"
              >
                <span className="text-xs font-medium text-zinc-200 truncate">
                  {p.profiles?.username || "Operative"}
                  {p.user_id === matchData.host_id && <span className="text-amber-400"> ★</span>}
                  {p.user_id === sessionUser.id && <span className="text-zinc-500"> (you)</span>}
                </span>
                <div className="flex items-center gap-1.5 shrink-0">
                  {isHost && p.user_id !== matchData.host_id && (
                    <>
                      <button
                        onClick={() => handleAssignRole(p.user_id, "hunter")}
                        className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${
                          p.role === "hunter" ? "bg-orange-500 text-zinc-950" : "bg-zinc-800 text-zinc-400"
                        }`}
                      >
                        Hunter
                      </button>
                      <button
                        onClick={() => handleAssignRole(p.user_id, "shadow")}
                        className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${
                          p.role === "shadow" ? "bg-emerald-500 text-zinc-950" : "bg-zinc-800 text-zinc-400"
                        }`}
                      >
                        Shadow
                      </button>
                    </>
                  )}
                  {!isHost && (
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${
                        p.role === "hunter"
                          ? "bg-orange-500/20 text-orange-400"
                          : p.role === "shadow"
                          ? "bg-emerald-500/20 text-emerald-400"
                          : "bg-zinc-800 text-zinc-400"
                      }`}
                    >
                      {p.role || "unassigned"}
                    </span>
                  )}
                  <span className={`text-[9px] font-bold ${p.ready ? "text-emerald-400" : "text-zinc-600"}`}>
                    {p.ready ? "READY" : "NOT RDY"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-zinc-900/60 border border-zinc-800/60 rounded-xl p-3 mb-4">
          <h4 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1.5">
            Match rules
          </h4>
          <p className="text-[11px] text-zinc-400 leading-relaxed">
            {settings.duration_minutes} min hunt · Shadows ping every {settings.shadow_ping_interval_minutes} min ·
            Hunter reveal every {settings.hunter_reveal_interval_minutes} min · Zone shrinks every{" "}
            {settings.zone_shrink_interval_minutes} min (from {settings.zone_initial_radius_m}m to{" "}
            {settings.zone_min_radius_m}m) · {settings.grace_period_minutes} min grace period.
          </p>
        </div>

        <HostSettingsPanel
          initial={settings}
          locked={!isHost}
          onSave={handleSaveSettings}
          saving={savingSettings}
        />

        <div className="mt-auto space-y-3 pt-4">
          
            <button
              onClick={handleToggleReady}
              className={`w-full py-3 font-bold rounded-xl text-sm uppercase tracking-wider transition ${
                myParticipant?.ready
                  ? "bg-zinc-800 border border-emerald-600 text-emerald-400"
                  : "bg-emerald-500 hover:bg-emerald-400 text-zinc-950"
              }`}
            >
              {myParticipant?.ready ? (
                <>
                  <CheckCircle2 className="w-4 h-4 inline mr-1" /> Ready — tap to unready
                </>
              ) : (
                "Mark ready"
              )}
            </button>
          
          {isHost && (
            <>
              <button
                onClick={handleRandomizeRoles}
                className="w-full py-2.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 font-bold rounded-xl text-xs flex items-center justify-center gap-2"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Randomize roles
              </button>
              <button
                onClick={handleStartMatch}
                className="w-full py-3.5 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-black tracking-wider uppercase rounded-xl text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20"
              >
                <Play className="w-4 h-4 fill-current" /> Deploy match
              </button>
              {!geo.lat && (
                <p className="text-center text-[10px] text-orange-400">
                  Waiting for GPS permission to place the safe zone...
                </p>
              )}
              {!allReady && (
                <p className="text-center text-[10px] text-zinc-500">
                  Tip: make sure everyone marked ready and has a role.
                </p>
              )}
            </>
          )}
          <button
            onClick={async () => {
              await supabase.rpc("leave_match", { _match: matchId });
              setMatchId(null);
              setMatchData(null);
            }}
            className="w-full py-2 text-xs text-red-400 hover:text-red-300"
          >
            Leave lobby
          </button>
        </div>
      </div>
    );
  }

  // ============================================================
  // 4. Results
  // ============================================================
  if (matchData?.status === "completed" || matchData?.status === "aborted") {
    return (
      <ResultsScreen
        match={matchData}
        participants={participants}
        myUserId={sessionUser.id}
        myRole={myParticipant?.role ?? null}
        onRematch={handleRematch}
        onExit={() => {
          setMatchId(null);
          setMatchData(null);
        }}
        rematchLoading={rematchLoading}
      />
    );
  }

  // ============================================================
  // 5. In game (active / paused)
  // ============================================================
  const isHunter = myParticipant?.role === "hunter";
  const activeShadows = participants.filter((p) => p.role === "shadow" && p.status === "active");
  const isHost = matchData.host_id === sessionUser.id;
  const paused = matchData.status === "paused";
  const graceActive = graceLeft != null && graceLeft > 0;
  const zoneWarning =
    nextShrinkMs != null && nextShrinkMs <= settings.zone_warning_seconds * 1000 && nextShrinkMs > 0;
  const captureConfirmLeft = activeCapture
    ? Math.max(
        0,
        (at(activeCapture.reported_at) ?? 0) + settings.capture_confirm_seconds * 1000 - serverNow
      )
    : null;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col p-3 select-none">
      {/* Top HUD */}
      <header className="bg-zinc-900/90 backdrop-blur border border-zinc-800 rounded-xl p-3 flex justify-between items-center mb-2 z-10">
        <div>
          <span
            className={`text-[10px] font-black uppercase px-2 py-0.5 rounded ${
              isHunter ? "bg-orange-500 text-zinc-950" : "bg-emerald-500 text-zinc-950"
            }`}
          >
            {isHunter ? "HUNTER" : "SHADOW"}
          </span>
          <div className="text-lg font-mono font-black mt-1 flex items-center gap-1.5">
            <Timer className="w-4 h-4 text-purple-400" />
            <span className={paused ? "text-zinc-500" : matchLeft != null && matchLeft < 300_000 ? "text-red-400" : "text-zinc-100"}>
              {paused ? "PAUSED" : fmtCountdown(matchLeft)}
            </span>
          </div>
          <div className="text-[11px] text-zinc-400">
            Zone radius: {Math.round(matchData?.zone_radius_m ?? 0)}m
          </div>
        </div>

        <div className="text-right space-y-0.5">
          <div className="text-xs font-bold text-zinc-300">
            Alive: <span className="text-emerald-400">{activeShadows.length}</span> shadows
          </div>
          <div className="text-[10px] text-zinc-500 flex items-center gap-1 justify-end">
            <Navigation className="w-2.5 h-2.5" />
            GPS: {geo.lat != null ? `±${Math.round(geo.accuracy || 0)}m` : "unavailable"}
          </div>
          <div className="text-[10px] text-zinc-500 font-mono">CODE: {matchData.code}</div>
        </div>
      </header>

      {/* Countdown chips */}
      <div className="grid grid-cols-3 gap-1.5 mb-2">
        <div className={`rounded-lg px-2 py-1.5 border text-center ${nextPingMs != null && nextPingMs < 30_000 ? "border-orange-500 bg-orange-500/10" : "border-zinc-800 bg-zinc-900"}`}>
          <div className="text-[9px] uppercase tracking-wider text-zinc-500">
            {isHunter ? "Next ping" : "Next reveal"}
          </div>
          <div className="text-xs font-mono font-bold text-zinc-200">
            {fmtCountdown(isHunter ? nextPingMs : nextRevealMs)}
          </div>
        </div>
        <div className={`rounded-lg px-2 py-1.5 border text-center ${!isHunter && nextRevealMs != null && nextRevealMs < 30_000 ? "border-orange-500 bg-orange-500/10" : "border-zinc-800 bg-zinc-900"}`}>
          <div className="text-[9px] uppercase tracking-wider text-zinc-500">
            {isHunter ? "Hunter reveal" : "Next ping"}
          </div>
          <div className="text-xs font-mono font-bold text-zinc-200">
            {fmtCountdown(isHunter ? nextRevealMs : nextPingMs)}
          </div>
        </div>
        <div className={`rounded-lg px-2 py-1.5 border text-center ${zoneWarning ? "border-orange-500 bg-orange-500/10" : "border-zinc-800 bg-zinc-900"}`}>
          <div className="text-[9px] uppercase tracking-wider text-zinc-500">Zone shrinks in</div>
          <div className="text-xs font-mono font-bold text-zinc-200">{fmtCountdown(nextShrinkMs)}</div>
        </div>
      </div>

      {notice && (
        <div className="bg-purple-950/80 border border-purple-700 text-purple-200 text-xs p-2.5 rounded-lg mb-2 text-center">
          {notice}
        </div>
      )}

      {/* Grace period banner */}
      {graceActive && (
        <div className="bg-emerald-600 text-zinc-950 font-black text-xs py-2 px-3 rounded-lg mb-2 flex items-center justify-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          GRACE PERIOD — spread out! Hunting starts in {fmtCountdown(graceLeft)}
        </div>
      )}

      {/* Zone shrink warning */}
      {zoneWarning && !graceActive && (
        <div className="bg-orange-500 text-zinc-950 font-black text-xs py-2 px-3 rounded-lg mb-2 flex items-center justify-center gap-2">
          <AlertTriangle className="w-4 h-4" /> SAFE ZONE SHRINKS IN {fmtCountdown(nextShrinkMs)} — HEAD TO CENTER!
        </div>
      )}

      {/* Outside zone */}
      {isOutsideZone && (
        <div className="bg-red-500 text-zinc-950 font-black text-xs py-2 px-3 rounded-lg mb-2 flex items-center justify-center gap-2">
          <AlertTriangle className="w-4 h-4" /> YOU ARE OUTSIDE THE SAFE ZONE! RETURN NOW!
        </div>
      )}

      {/* GPS problems */}
      {geo.error && geo.lat == null && (
        <div className="bg-zinc-900 border border-zinc-700 text-zinc-300 text-xs py-2 px-3 rounded-lg mb-2 flex items-center gap-2">
          <XCircle className="w-4 h-4 text-red-400" /> Location unavailable — check GPS permission.
        </div>
      )}

      {/* Map radar */}
      <div className="flex-1 w-full min-h-[320px] relative">
        <Suspense
    fallback={
      <div className="flex h-full min-h-[320px] items-center justify-center bg-zinc-950 border border-zinc-800 text-xs font-mono text-zinc-500 rounded-xl">
        INITIALIZING TACTICAL RADAR...
      </div>
    }
  >
        <TacticalMap
          userLat={geo.lat}
          userLng={geo.lng}
          userRole={myParticipant?.role ?? null}
          zoneCenter={
            matchData?.zone_center_lat != null && matchData?.zone_center_lng != null
              ? { lat: matchData.zone_center_lat, lng: matchData.zone_center_lng }
              : null
          }
          zoneRadiusM={matchData?.zone_radius_m ?? null}
          reveals={reveals}
          isOutsideZone={isOutsideZone}
        />
          </Suspense>
      </div>

      {/* Capture confirmation modal */}
      {activeCapture && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur z-[9999] flex items-center justify-center p-4">
          <div className="bg-zinc-900 border-2 border-red-500 rounded-2xl p-6 max-w-sm w-full text-center space-y-4">
            <AlertTriangle className="w-12 h-12 text-red-500 mx-auto animate-pulse" />
            <h2 className="text-lg font-black text-red-400 uppercase">You were found!</h2>
            <p className="text-xs text-zinc-300">
              A Hunter reported capturing you. Did they physically tag/find you?
            </p>
            {captureConfirmLeft != null && captureConfirmLeft > 0 && (
              <p className="text-[10px] text-orange-400">
                Auto-confirms in {fmtCountdown(captureConfirmLeft)} if you don't respond.
              </p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => handleResolveCapture(false)}
                className="flex-1 py-3 bg-zinc-800 text-zinc-300 font-bold rounded-xl text-xs"
              >
                Dispute
              </button>
              <button
                onClick={() => handleResolveCapture(true)}
                className="flex-1 py-3 bg-red-600 hover:bg-red-500 text-white font-bold rounded-xl text-xs uppercase"
              >
                Confirm capture
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom controls */}
      <div className="pt-3 space-y-2">
        {isHunter && (
          <div className="bg-zinc-900/90 border border-zinc-800 p-2.5 rounded-xl">
            <span className="text-[10px] font-bold text-zinc-400 uppercase block mb-1">
              Report found shadow
            </span>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {activeShadows.map((s) => (
                <button
                  key={s.user_id}
                  onClick={() => handleReportCapture(s.user_id)}
                  className="px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-zinc-950 font-black rounded-lg text-xs whitespace-nowrap uppercase tracking-wider"
                >
                  Found {s.profiles?.username || "Shadow"}
                </button>
              ))}
              {activeShadows.length === 0 && (
                <span className="text-xs text-zinc-500">All shadows captured!</span>
              )}
            </div>
          </div>
        )}

        {isHost && (
          <div className="flex gap-2">
            {paused ? (
              <button
                onClick={() => handleHostControl("resume_match")}
                className="flex-1 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold rounded-xl text-xs uppercase flex items-center justify-center gap-1.5"
              >
                <Play className="w-3.5 h-3.5 fill-current" /> Resume
              </button>
            ) : (
              <button
                onClick={() => handleHostControl("pause_match")}
                className="flex-1 py-2.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 font-bold rounded-xl text-xs uppercase flex items-center justify-center gap-1.5"
              >
                <Pause className="w-3.5 h-3.5" /> Pause
              </button>
            )}
            <button
              onClick={() => handleHostControl("abort_match")}
              className="flex-1 py-2.5 bg-zinc-900 hover:bg-zinc-800 border border-red-800 text-red-400 font-bold rounded-xl text-xs uppercase"
            >
              End match
            </button>
          </div>
        )}

        <div className="flex justify-between items-center px-1">
          <button
            onClick={handleEmergencyExit}
            className="text-[11px] text-red-400 flex items-center gap-1 hover:underline"
          >
            <ShieldAlert className="w-3.5 h-3.5" /> Emergency exit
          </button>
          <span className="text-[10px] text-zinc-500">
            Reveal locations refresh automatically · stay in the zone
          </span>
        </div>
      </div>
    </div>
  );
}
