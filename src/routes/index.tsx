import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useTransition } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useGeolocation } from "@/hooks/useGeolocation";
import { TacticalMap } from "@/components/game/TacticalMap";
import {
  ShieldAlert,
  Crosshair,
  User,
  LogOut,
  Play,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Radio,
  Timer,
  Navigation,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Shadow Hunt - Tactical IRL Manhunt" },
      { name: "description", content: "Real-life multiplayer GPS hunter-vs-runner game" },
    ],
  }),
  component: ShadowHuntApp,
});

export default function ShadowHuntApp() {
  // Auth state
  const [sessionUser, setSessionUser] = useState<any>(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Match / Lobby State
  const [matchId, setMatchId] = useState<string | null>(null);
  const [matchData, setMatchData] = useState<any>(null);
  const [participants, setParticipants] = useState<any[]>([]);
  const [joinCode, setJoinCode] = useState("");
  const [myParticipant, setMyParticipant] = useState<any>(null);
  const [reveals, setReveals] = useState<any[]>([]);
  const [activeCapture, setActiveCapture] = useState<any>(null);
  const [isPending, startTransition] = useTransition();

  // GPS tracking hook
  const geo = useGeolocation(Boolean(matchId && matchData?.status === "in_progress"));

  // 1. Session check & listener
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSessionUser(data.session?.user ?? null);
    });
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSessionUser(session?.user ?? null);
    });
    return () => authListener.subscription.unsubscribe();
  }, []);

  // 2. Fetch match and participants
  const refreshMatch = useCallback(async (id: string) => {
    const { data: m } = await supabase.from("matches").select("*").eq("id", id).maybeSingle();
    if (m) setMatchData(m);

    const { data: parts } = await supabase
      .from("match_participants")
      .select("*, profiles:user_id(username)")
      .eq("match_id", id);
    if (parts) {
      setParticipants(parts);
      const mine = parts.find((p) => p.user_id === sessionUser?.id);
      setMyParticipant(mine || null);
    }

    const { data: revs } = await supabase
      .from("location_reveals")
      .select("*")
      .eq("match_id", id)
      .order("revealed_at", { ascending: false })
      .limit(20);
    if (revs) setReveals(revs);
  }, [sessionUser?.id]);

  // 3. Realtime subscription for game updates
  useEffect(() => {
    if (!matchId) return;
    refreshMatch(matchId);

    const channel = supabase
      .channel(`match:${matchId}`)
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
        () => refreshMatch(matchId)
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "capture_reports", filter: `match_id=eq.${matchId}` },
        async (payload: any) => {
          if (payload.new && payload.new.target_id === sessionUser?.id && payload.new.status === "pending") {
            setActiveCapture(payload.new);
          } else {
            setActiveCapture(null);
          }
          refreshMatch(matchId);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [matchId, refreshMatch, sessionUser?.id]);

  // 4. Tick loop & Position transmission during match
  useEffect(() => {
    if (!matchId || matchData?.status !== "in_progress") return;

    const interval = setInterval(async () => {
      // Periodic server-authoritative game state evaluation
      try {
        await supabase.rpc("tick_match", { _match: matchId });
      } catch (e) {
        console.error("Tick error", e);
      }

      // Transmit current player GPS coordinates
      if (geo.lat && geo.lng) {
        try {
          await supabase.rpc("submit_position", {
            _match: matchId,
            _lat: geo.lat,
            _lng: geo.lng,
            _accuracy: geo.accuracy || 10,
            _speed: geo.speed || 0,
            _heading: geo.heading || 0,
          });
        } catch (e) {
          console.error("Position submission error", e);
        }
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [matchId, matchData?.status, geo.lat, geo.lng, geo.accuracy, geo.speed, geo.heading]);

  // Match Actions
  const handleCreateMatch = async () => {
    startTransition(async () => {
      try {
        const { data, error } = await supabase.rpc("create_match", {
          _settings: {
            duration_minutes: 60,
            shadow_ping_interval_minutes: 3,
            hunter_reveal_interval_minutes: 5,
            zone_shrink_interval_minutes: 10,
            zone_initial_radius_m: 400,
            zone_min_radius_m: 60,
          },
        });
        if (error) throw error;
        const res = data as { id: string; code: string };
        setMatchId(res.id);
      } catch (err: any) {
        alert(err.message || "Failed to create match");
      }
    });
  };

  const handleJoinMatch = async () => {
    if (!joinCode) return;
    startTransition(async () => {
      try {
        const { data, error } = await supabase.rpc("join_match", { _code: joinCode.trim() });
        if (error) throw error;
        setMatchId(data as string);
      } catch (err: any) {
        alert(err.message || "Failed to join match");
      }
    });
  };

  const handleStartMatch = async () => {
    if (!matchId) return;
    const centerLat = geo.lat || 28.6139;
    const centerLng = geo.lng || 77.209;
    startTransition(async () => {
      try {
        await supabase.rpc("start_match", {
          _match: matchId,
          _center_lat: centerLat,
          _center_lng: centerLng,
        });
        await refreshMatch(matchId);
      } catch (err: any) {
        alert(err.message || "Failed to start match");
      }
    });
  };

  const handleRandomizeRoles = async () => {
    if (!matchId) return;
    try {
      await supabase.rpc("randomize_roles", { _match: matchId });
      refreshMatch(matchId);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleReportCapture = async (targetId: string) => {
    if (!matchId) return;
    try {
      await supabase.rpc("report_capture", { _match: matchId, _target: targetId });
      alert("FOUND report submitted! Waiting for target confirmation.");
    } catch (err: any) {
      alert(err.message || "Capture report failed.");
    }
  };

  const handleResolveCapture = async (confirm: boolean) => {
    if (!activeCapture) return;
    try {
      await supabase.rpc("resolve_capture", {
        _report: activeCapture.id,
        _confirm: confirm,
      });
      setActiveCapture(null);
      if (matchId) refreshMatch(matchId);
    } catch (err: any) {
      alert(err.message || "Failed to resolve capture.");
    }
  };

  const handleEmergencyExit = async () => {
    if (!matchId) return;
    if (confirm("Emergency Stop: Are you sure you want to leave the match immediately?")) {
      await supabase.rpc("leave_match", { _match: matchId });
      setMatchId(null);
      setMatchData(null);
    }
  };

  // Auth Submit
  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError(null);
    try {
      if (authMode === "signup") {
        const { error } = await supabase.auth.signUp({
          email: authEmail,
          password: authPassword,
        });
        if (error) throw error;
        alert("Account created! You can now log in.");
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

  // 1. Unauthenticated View
  if (!sessionUser) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col justify-center items-center px-4 py-8">
        <div className="max-w-md w-full bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-2xl">
          <div className="flex items-center justify-center gap-3 mb-6">
            <Radio className="w-8 h-8 text-emerald-400 animate-pulse" />
            <h1 className="text-2xl font-black tracking-widest text-emerald-400 uppercase">
              SHADOW HUNT
            </h1>
          </div>
          <p className="text-xs text-zinc-400 text-center mb-6">
            IRL Tactical Multiplayer Manhunt with Real GPS Tracking.
          </p>

          {authError && (
            <div className="bg-red-950/80 border border-red-700 text-red-200 text-xs p-3 rounded-lg mb-4">
              {authError}
            </div>
          )}

          <form onSubmit={handleAuth} className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-zinc-400">Email Address</label>
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
              {authLoading ? "Authenticating..." : authMode === "login" ? "Enter Warzone" : "Register Operative"}
            </button>
          </form>

          <div className="mt-4 text-center">
            <button
              onClick={() => setAuthMode(authMode === "login" ? "signup" : "login")}
              className="text-xs text-zinc-400 hover:text-emerald-400 underline"
            >
              {authMode === "login" ? "Need an operative account? Sign Up" : "Existing operative? Log In"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 2. Main Lobby View (No Match Selected)
  if (!matchId) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 p-4 max-w-lg mx-auto flex flex-col justify-between">
        <header className="flex justify-between items-center py-4 border-b border-zinc-800">
          <div>
            <h1 className="text-lg font-black tracking-wider text-emerald-400">SHADOW HUNT</h1>
            <p className="text-xs text-zinc-400">{sessionUser.email}</p>
          </div>
          <button
            onClick={() => supabase.auth.signOut()}
            className="p-2 text-zinc-400 hover:text-red-400 bg-zinc-900 rounded-lg border border-zinc-800"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </header>

        <main className="my-auto space-y-6">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 text-center space-y-4">
            <Crosshair className="w-12 h-12 text-emerald-400 mx-auto" />
            <h2 className="text-lg font-bold">Start a New Hunt</h2>
            <p className="text-xs text-zinc-400">
              Host a room, configure custom timers and radius, and invite your friends.
            </p>
            <button
              onClick={handleCreateMatch}
              disabled={isPending}
              className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold rounded-xl text-sm transition tracking-wider uppercase"
            >
              Create Tactical Room
            </button>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 text-center space-y-3">
            <h2 className="text-sm font-bold text-zinc-300">Join Existing Room</h2>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="6-CHAR CODE"
                maxLength={6}
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-xl text-center text-sm font-mono tracking-widest uppercase focus:border-emerald-500 outline-none"
              />
              <button
                onClick={handleJoinMatch}
                disabled={isPending || !joinCode}
                className="px-6 py-2 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl text-sm transition"
              >
                Join
              </button>
            </div>
          </div>
        </main>

        <footer className="text-center text-[10px] text-zinc-500 pb-2">
          Always obey local laws. No trespassing. Play responsibly.
        </footer>
      </div>
    );
  }

  // 3. Room Lobby View (Waiting for Players)
  if (matchData?.status === "lobby") {
    const isHost = matchData.host_id === sessionUser.id;
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 p-4 max-w-lg mx-auto flex flex-col justify-between">
        <div>
          <div className="flex justify-between items-center py-3 border-b border-zinc-800 mb-4">
            <span className="text-xs uppercase text-zinc-400">Lobby Code</span>
            <span className="text-xl font-mono font-black text-emerald-400 tracking-widest">
              {matchData.code}
            </span>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 mb-4">
            <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">
              Operatives Joined ({participants.length})
            </h3>
            <div className="space-y-2">
              {participants.map((p) => (
                <div
                  key={p.id}
                  className="flex justify-between items-center bg-zinc-950 px-3 py-2 rounded-lg border border-zinc-800/80"
                >
                  <span className="text-xs font-medium text-zinc-200">
                    {p.profiles?.username || "Operative"} {p.user_id === matchData.host_id && "⭐ Host"}
                  </span>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${
                      p.role === "hunter"
                        ? "bg-orange-500/20 text-orange-400"
                        : p.role === "shadow"
                        ? "bg-emerald-500/20 text-emerald-400"
                        : "bg-zinc-800 text-zinc-400"
                    }`}
                  >
                    {p.role || "Unassigned"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-3 pb-4">
          {isHost ? (
            <>
              <button
                onClick={handleRandomizeRoles}
                className="w-full py-2.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 font-bold rounded-xl text-xs flex items-center justify-center gap-2"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Randomize Roles
              </button>
              <button
                onClick={handleStartMatch}
                className="w-full py-3.5 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-black tracking-wider uppercase rounded-xl text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20"
              >
                <Play className="w-4 h-4 fill-current" /> Deploy Match
              </button>
            </>
          ) : (
            <div className="text-center text-xs text-zinc-400 animate-pulse py-2">
              Waiting for host to deploy operatives...
            </div>
          )}
          <button
            onClick={() => {
              supabase.rpc("leave_match", { _match: matchId });
              setMatchId(null);
            }}
            className="w-full py-2 text-xs text-red-400 hover:text-red-300"
          >
            Leave Lobby
          </button>
        </div>
      </div>
    );
  }

  // 4. In-Game View (Active / In Progress)
  const isHunter = myParticipant?.role === "hunter";
  const activeShadows = participants.filter((p) => p.role === "shadow" && p.status === "active");

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col justify-between p-3 select-none">
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
          <div className="text-[11px] text-zinc-400 mt-1 flex items-center gap-1">
            <Timer className="w-3 h-3 text-purple-400" />
            <span>Zone Radius: {Math.round(matchData?.zone_radius_m || 0)}m</span>
          </div>
        </div>

        <div className="text-right">
          <div className="text-xs font-bold text-zinc-300">
            Alive: <span className="text-emerald-400">{activeShadows.length}</span> Shadows
          </div>
          <div className="text-[10px] text-zinc-500 flex items-center gap-1 justify-end">
            <Navigation className="w-2.5 h-2.5" />
            GPS: ±{Math.round(geo.accuracy || 0)}m
          </div>
        </div>
      </header>

      {/* Warning: Outside Safe Zone */}
      {myParticipant?.is_outside_zone && (
        <div className="bg-red-500 text-zinc-950 font-black text-xs py-2 px-3 rounded-lg mb-2 flex items-center justify-center gap-2 animate-bounce">
          <AlertTriangle className="w-4 h-4" /> YOU ARE OUTSIDE THE SAFE ZONE! RETURN NOW!
        </div>
      )}

      {/* Map Radar */}
      <div className="flex-1 w-full min-h-[350px] relative">
        <TacticalMap
          userLat={geo.lat}
          userLng={geo.lng}
          userRole={myParticipant?.role}
          zoneCenter={
            matchData?.zone_center_lat && matchData?.zone_center_lng
              ? { lat: matchData.zone_center_lat, lng: matchData.zone_center_lng }
              : null
          }
          zoneRadiusM={matchData?.zone_radius_m}
          reveals={reveals}
    isOutsideZone={myParticipant?.is_outside_zone}
        />
      </div>

      {/* Capture Confirmation Modal */}
      {activeCapture && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur z-[9999] flex items-center justify-center p-4">
          <div className="bg-zinc-900 border-2 border-red-500 rounded-2xl p-6 max-w-sm w-full text-center space-y-4">
            <AlertTriangle className="w-12 h-12 text-red-500 mx-auto animate-pulse" />
            <h2 className="text-lg font-black text-red-400 uppercase">You Were Found!</h2>
            <p className="text-xs text-zinc-300">
              A Hunter reported capturing you. Did they physically tag/find you?
            </p>
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
                Confirm Capture
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Controls / FOUND Action */}
      <div className="pt-3 space-y-2">
        {isHunter && (
          <div className="bg-zinc-900/90 border border-zinc-800 p-2.5 rounded-xl">
            <span className="text-[10px] font-bold text-zinc-400 uppercase block mb-1">
              Report Found Shadow
            </span>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {activeShadows.map((s) => (
                <button
                  key={s.user_id}
                  onClick={() => handleReportCapture(s.user_id)}
                  className="px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-zinc-950 font-black rounded-lg text-xs whitespace-nowrap uppercase tracking-wider"
                >
                  FOUND {s.profiles?.username || "SHADOW"}
                </button>
              ))}
              {activeShadows.length === 0 && (
                <span className="text-xs text-zinc-500">All Shadows captured!</span>
              )}
            </div>
          </div>
        )}

        <div className="flex justify-between items-center px-1">
          <button
            onClick={handleEmergencyExit}
            className="text-[11px] text-red-400 flex items-center gap-1 hover:underline"
          >
            <ShieldAlert className="w-3.5 h-3.5" /> Emergency Exit
          </button>
          <span className="text-[10px] text-zinc-500 font-mono">CODE: {matchData?.code}</span>
        </div>
      </div>
    </div>
  );
}
